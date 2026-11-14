'use strict';

// Phase 7 (gaps 11, 15, 17, 19, 20, 21) behavior tests. All mocked:
// no real database, following the patterns in
// restaurantPhase6TableFoodCost.test.js.

const express = require('express');
const request = require('supertest');
const { mockQuery, resetMocks } = require('./setup');
const { errorHandler } = require('../middleware/errorHandler');

jest.mock('../utils/redis', () => null);
jest.mock('../services/scopeModel', () => ({
  resolveRestaurantAccess: jest.fn(async () => ({ id: 3, business_id: 42, display_name: 'Ox Burger Lab', effective_role: 'manager' })),
}));
jest.mock('../services/permissionsService', () => ({
  hasRestaurantPermission: jest.fn(async () => true),
  getEffectivePermissions: jest.fn().mockResolvedValue({ permissions: new Set(['inventory.view', 'inventory.manage']), raw: {} }),
  hasAny: (permissionSet, requested) => requested.some((permission) => permissionSet.has(permission)),
}));
jest.mock('../services/notificationService', () => ({
  sendNotification: jest.fn(async () => ({})),
}));
jest.mock('../utils/email', () => ({
  sendEmail: jest.fn(async () => ({})),
}));
jest.mock('../services/restaurantPayrollService', () => ({
  computeLabor: jest.fn(async () => ({
    from_date: '2026-11-05',
    to_date: '2026-11-05',
    timezone: 'UTC',
    currency: 'USD',
    currency_minor_unit_decimals: 2,
    revenues: [{ currency: 'USD', revenue_cents: 50000 }],
    revenue_cents: 50000,
    labor_cost_cents: 10000,
    labor_percent: 20,
    total_hours: 8,
    overtime_hours: 0,
    meal_break_premium_cents: 100,
    predictability_premium_cents: 0,
  })),
  computeExceptions: jest.fn(async () => ({
    from_date: '2026-11-05',
    to_date: '2026-11-05',
    timezone: 'UTC',
    employees: [],
  })),
}));
jest.mock('../controllers/restaurantReportsController', () => ({
  _computeDailyClose: jest.fn(async () => ({
    business_date: '2026-11-05',
    timezone: 'UTC',
    locations: [],
    brand_totals: [{ currency: 'USD', totals: { revenue_cents: 12345 } }],
  })),
}));

const { parseRangeText, resolveThresholds, isBreach, recordTemperatureLog, linkCorrectiveAction } = require('../services/restaurantTemperatureService');
const { evaluateMinorPunch, resolveRules } = require('../services/laborJurisdictionRules');
const { recordBreakAttestation, latestAttestation, attestationSummaryByUser, listAttestations } = require('../services/restaurantBreakAttestation');
const { computePrimeCost, computeFoodCostTotals, computeServerBreakdown, computeDaypartBreakdown } = require('../services/restaurantPrimeCostService');
const { getCachedRollup, ROLLUP_TTL_SECONDS } = require('../services/restaurantRollupCache');
const scheduledReports = require('../services/restaurantScheduledReports');
const retention = require('../services/restaurantRetentionService');
const { kitchenFeedLimiter } = require('../middleware/rateLimiter');
const { sendNotification } = require('../services/notificationService');
const { sendEmail } = require('../utils/email');

const USER_ID = '00000000-0000-4000-8000-000000000123';
const client = { query: (...args) => mockQuery(...args) };

beforeEach(() => {
  resetMocks();
  jest.clearAllMocks();
});

describe('Phase 7: temperature thresholds (gap 11)', () => {
  test('parses a plain min-max label and rejects free text', () => {
    expect(parseRangeText('2-4C')).toEqual({ min: 2, max: 4 });
    expect(parseRangeText('-18 to -15')).toEqual({ min: -18, max: -15 });
    expect(parseRangeText('cold')).toBeNull();
    expect(parseRangeText('4-2')).toBeNull();
  });

  test('numeric area columns win over the range label; no config means no threshold', () => {
    expect(resolveThresholds({ temperature_min_c: 0, temperature_max_c: 4, temperature_range: '2-8' }))
      .toEqual({ min: 0, max: 4, source: 'area_config' });
    expect(resolveThresholds({ temperature_min_c: null, temperature_max_c: null, temperature_range: '2-4C' }))
      .toEqual({ min: 2, max: 4, source: 'area_range_label' });
    expect(resolveThresholds({ temperature_min_c: null, temperature_max_c: null, temperature_range: 'cold' }))
      .toEqual({ min: null, max: null, source: 'none' });
    expect(resolveThresholds(null)).toEqual({ min: null, max: null, source: 'none' });
  });

  test('a reading on the boundary is not a breach', () => {
    expect(isBreach(4, { min: 2, max: 4 })).toBe(false);
    expect(isBreach(2, { min: 2, max: 4 })).toBe(false);
    expect(isBreach(4.01, { min: 2, max: 4 })).toBe(true);
    expect(isBreach(1.99, { min: 2, max: 4 })).toBe(true);
    expect(isBreach(99, null)).toBe(false);
  });

  test('records a breach with the threshold snapshot and rejects a bad reading', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 9, restaurant_id: 3, name: 'Walk-in cooler', temperature_min_c: 2, temperature_max_c: 4, temperature_range: '2-4C' }] });
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 1, restaurant_id: 3, area_id: 9, area_name: 'Walk-in cooler', reading_celsius: '9.00', threshold_min_c: '2.00', threshold_max_c: '4.00', breach: true, business_date: '2026-11-06' }] });
    const { log, breach } = await recordTemperatureLog(client, {
      restaurantId: 3, locationId: 7, areaId: 9, readingCelsius: 9, recordedBy: USER_ID, businessDate: '2026-11-06',
    });
    expect(breach).toBe(true);
    expect(log.breach).toBe(true);
    expect(log.threshold_min_c).toBe(2);
    expect(log.threshold_max_c).toBe(4);
    await expect(recordTemperatureLog(client, { restaurantId: 3, readingCelsius: 'hot' }))
      .rejects.toMatchObject({ status: 400 });
  });

  test('linking a corrective action requires the action to belong to the restaurant', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await expect(linkCorrectiveAction(client, { restaurantId: 3, logId: 1, correctiveActionId: 99 }))
      .rejects.toMatchObject({ status: 404 });
  });
});

describe('Phase 7: punch-time minor check (gap 17)', () => {
  const ca = resolveRules({ jurisdiction_code: 'US-CA' });

  test('under-16 clock-in before 07:00 blocks', () => {
    const result = evaluateMinorPunch({
      band: 'under_16', rules: ca, workDate: '2026-11-06', clockInTime: '06:30',
      shift: null, hoursWorkedToday: 0, hoursWorkedThisWeek: 0,
    });
    expect(result.blocked).toBe(true);
    expect(result.violations.map((v) => v.rule)).toContain('minor_u16_window');
  });

  test('under-16 school-day 3h limit warns, not blocks; a compliant shift passes with no warning (finding 31, applied per review)', () => {
    const warned = evaluateMinorPunch({
      band: 'under_16', rules: ca, workDate: '2026-11-06', clockInTime: '15:00',
      shift: { shift_date: '2026-11-06', start_time: '15:00', end_time: '19:00' },
      hoursWorkedToday: 0, hoursWorkedThisWeek: 0,
    });
    expect(warned.blocked).toBe(false);
    expect(warned.warnings.map((w) => w.rule)).toContain('minor_u16_daily');
    expect(warned.violations).toEqual([]);
    const ok = evaluateMinorPunch({
      band: 'under_16', rules: ca, workDate: '2026-11-07', clockInTime: '09:00',
      shift: { shift_date: '2026-11-07', start_time: '09:00', end_time: '12:00' },
      hoursWorkedToday: 0, hoursWorkedThisWeek: 0,
    });
    expect(ok.blocked).toBe(false);
    expect(ok.warnings).toEqual([]);
    // Saturday is a non-school day: the 8h cap still blocks.
    const blocked = evaluateMinorPunch({
      band: 'under_16', rules: ca, workDate: '2026-11-07', clockInTime: '09:00',
      shift: { shift_date: '2026-11-07', start_time: '09:00', end_time: '18:00' },
      hoursWorkedToday: 0, hoursWorkedThisWeek: 0,
    });
    expect(blocked.blocked).toBe(true);
    expect(blocked.violations.map((v) => v.rule)).toContain('minor_u16_daily');
  });

  test('16-17 latest end blocks; no published shift warns but does not block', () => {
    const blocked = evaluateMinorPunch({
      band: 'age_16_17', rules: ca, workDate: '2026-11-06', clockInTime: '18:00',
      shift: { shift_date: '2026-11-06', start_time: '18:00', end_time: '23:00' },
      hoursWorkedToday: 0, hoursWorkedThisWeek: 0,
    });
    expect(blocked.blocked).toBe(true);
    expect(blocked.violations.map((v) => v.rule)).toContain('minor_latest_end');
    const flagged = evaluateMinorPunch({
      band: 'age_16_17', rules: ca, workDate: '2026-11-06', clockInTime: '09:00',
      shift: null, hoursWorkedToday: 0, hoursWorkedThisWeek: 0,
    });
    expect(flagged.blocked).toBe(false);
    expect(flagged.warnings.map((w) => w.rule)).toContain('minor_no_shift');
    // Finding 49: the unscheduled shift is capped at the
    // jurisdiction's minor max daily hours (CA: 8h), less the hours
    // already worked today. A cap of 0 still surfaces.
    expect(flagged.shift_cap_hours).toBe(8);
    const partlyWorked = evaluateMinorPunch({
      band: 'age_16_17', rules: ca, workDate: '2026-11-06', clockInTime: '15:00',
      shift: null, hoursWorkedToday: 3, hoursWorkedThisWeek: 3,
    });
    expect(partlyWorked.shift_cap_hours).toBe(5);
    const overLimit = evaluateMinorPunch({
      band: 'age_16_17', rules: ca, workDate: '2026-11-06', clockInTime: '20:00',
      shift: null, hoursWorkedToday: 9, hoursWorkedThisWeek: 9,
    });
    expect(overLimit.shift_cap_hours).toBe(0);
    // A scheduled shift has no cap: its own hours are evaluated.
    expect(blocked.shift_cap_hours).toBeNull();
  });

  test('no minor max daily hours means no cap, only the warning (finding 49)', () => {
    const custom = resolveRules({ jurisdiction_code: 'CUSTOM' });
    // The CUSTOM preset carries no minor max daily hours at all.
    expect(custom.minor_max_daily_hours == null).toBe(true);
    const flagged = evaluateMinorPunch({
      band: 'age_16_17', rules: custom, workDate: '2026-11-06', clockInTime: '09:00',
      shift: null, hoursWorkedToday: 0, hoursWorkedThisWeek: 0,
    });
    expect(flagged.blocked).toBe(false);
    expect(flagged.warnings.map((w) => w.rule)).toContain('minor_no_shift');
    expect(flagged.shift_cap_hours).toBeNull();
  });

  test('an expired minor_until means the band no longer applies', () => {
    const result = evaluateMinorPunch({
      band: 'under_16', minorUntil: '2026-01-01', rules: ca,
      workDate: '2026-11-06', clockInTime: '06:30',
    });
    expect(result.applies).toBe(false);
    expect(result.blocked).toBe(false);
  });
});

describe('Phase 7: break attestation (gap 17)', () => {
  const entry = {
    id: 5, business_id: 42, user_id: USER_ID, entry_date: '2026-11-06',
    location_id: 7, hours_worked: '6.00', breaks: [],
    clock_in_at: '2026-11-06T09:00:00Z', clock_out_at: '2026-11-06T15:00:00Z',
    voided_at: null,
  };
  const caRow = {
    restaurant_id: 3, location_id: 7, jurisdiction_code: 'US-CA',
    meal_break_after_minutes: 300, meal_break_duration_minutes: 30,
    meal_break_premium_hours: 1,
  };

  test('attesting "taken" while the punch record shows a missed meal break is disputed, premium still owed', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [entry] });
    mockQuery.mockResolvedValueOnce({ rows: [{ restaurant_id: 3 }] });
    mockQuery.mockResolvedValueOnce({ rows: [caRow] });
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 9, time_entry_id: 5, meal_break_taken: true, waived: false, disputed: true }] });
    const recorded = await recordBreakAttestation(client, {
      businessId: 42, userId: USER_ID, timeEntryId: 5, mealBreakTaken: true,
    });
    expect(recorded.disputed).toBe(true);
    expect(recorded.missedMealBreak).toBe(true);
    expect(recorded.mealBreakPremiumHours).toBe(1);
  });

  test('a waived break with a reason confirms the missed break and is not disputed', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [entry] });
    mockQuery.mockResolvedValueOnce({ rows: [{ restaurant_id: 3 }] });
    mockQuery.mockResolvedValueOnce({ rows: [caRow] });
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 10, time_entry_id: 5, meal_break_taken: false, waived: true, disputed: false }] });
    const recorded = await recordBreakAttestation(client, {
      businessId: 42, userId: USER_ID, timeEntryId: 5,
      mealBreakTaken: false, waived: true, waiverReason: 'Lunch rush, manager approved',
    });
    expect(recorded.disputed).toBe(false);
    expect(recorded.missedMealBreak).toBe(true);
    expect(recorded.mealBreakPremiumHours).toBe(1);
  });

  test('a waiver without a reason and a taken+waived contradiction are rejected before any query', async () => {
    await expect(recordBreakAttestation(client, {
      businessId: 42, userId: USER_ID, timeEntryId: 5, mealBreakTaken: false, waived: true, waiverReason: ' ',
    })).rejects.toMatchObject({ status: 400 });
    await expect(recordBreakAttestation(client, {
      businessId: 42, userId: USER_ID, timeEntryId: 5, mealBreakTaken: true, waived: true, waiverReason: 'x',
    })).rejects.toMatchObject({ status: 400 });
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test('a second attestation appends a new version instead of rewriting the first (item 43)', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [entry] });
    mockQuery.mockResolvedValueOnce({ rows: [{ restaurant_id: 3 }] });
    mockQuery.mockResolvedValueOnce({ rows: [caRow] });
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 11, time_entry_id: 5, meal_break_taken: false, waived: false, disputed: false }] });
    const recorded = await recordBreakAttestation(client, {
      businessId: 42, userId: USER_ID, timeEntryId: 5, mealBreakTaken: false,
    });
    expect(recorded.attestation.id).toBe(11);
    const insertSql = mockQuery.mock.calls[3][0];
    expect(insertSql).toMatch(/INSERT INTO restaurant_break_attestations/);
    expect(insertSql).not.toMatch(/ON CONFLICT/);
  });

  test('summary, list and latest lookup read the latest version only (item 43)', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [
      { user_id: USER_ID, attestations: 1, waived_breaks: 0, missed_breaks: 1, disputed_attestations: 0 },
    ] });
    const byUser = await attestationSummaryByUser(client, {
      businessId: 42, fromDate: '2026-11-06', toDate: '2026-11-06',
    });
    expect(mockQuery.mock.calls[0][0]).toMatch(/DISTINCT ON \(time_entry_id\)/);
    expect(byUser.get(USER_ID).missed_breaks).toBe(1);

    mockQuery.mockResolvedValueOnce({ rows: [
      { id: 11, time_entry_id: 5, meal_break_taken: false, user_name: 'Test User' },
    ] });
    const listed = await listAttestations(client, { businessId: 42 });
    expect(mockQuery.mock.calls[1][0]).toMatch(/DISTINCT ON \(time_entry_id\)/);
    expect(listed).toHaveLength(1);
    expect(listed[0].meal_break_taken).toBe(false);

    mockQuery.mockResolvedValueOnce({ rows: [{ id: 11, time_entry_id: 5, meal_break_taken: false }] });
    const latest = await latestAttestation(client, { businessId: 42, timeEntryId: 5 });
    expect(mockQuery.mock.calls[2][0]).toMatch(/ORDER BY attested_at DESC, id DESC/);
    expect(latest.id).toBe(11);
  });
});

describe('Phase 7: prime cost (gap 15)', () => {
  test('food-cost totals convert major-unit costs with per-currency precision', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{
      net_sales_cents: 10000, theoretical_cost_major: '30.00', actual_cost_major: '32.50',
    }] });
    const food = await computeFoodCostTotals(client, {
      restaurantId: 3, fromDate: '2026-11-05', toDate: '2026-11-05', timezone: 'UTC', currencyCode: 'USD',
    });
    expect(food.net_sales_cents).toBe(10000);
    expect(food.theoretical_cost_cents).toBe(3000);
    expect(food.actual_cost_cents).toBe(3250);
    expect(food.theoretical_cost_pct).toBe(30);
    expect(food.actual_cost_pct).toBe(32.5);
  });

  test('server breakdown attributes by acting staff with an unattributed bucket', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [
      { user_id: USER_ID, orders: 4, net_sales_cents: 8000, tips_cents: 1200, discount_cents: 0 },
      { user_id: null, orders: 1, net_sales_cents: 2000, tips_cents: 0, discount_cents: 100 },
    ] });
    const { servers, unattributed } = await computeServerBreakdown(client, {
      restaurantId: 3, fromDate: '2026-11-05', toDate: '2026-11-05', timezone: 'UTC',
    });
    expect(servers).toHaveLength(1);
    expect(servers[0].avg_ticket_cents).toBe(2000);
    expect(unattributed.orders).toBe(1);
    expect(unattributed.net_sales_cents).toBe(2000);
  });

  test('daypart buckets follow the documented hour ranges', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [
      { hour: 7, orders: 2, net_sales_cents: 3000 },
      { hour: 12, orders: 5, net_sales_cents: 9000 },
      { hour: 19, orders: 6, net_sales_cents: 12000 },
      { hour: 23, orders: 1, net_sales_cents: 1500 },
    ] });
    const { hourly, dayparts } = await computeDaypartBreakdown(client, {
      restaurantId: 3, fromDate: '2026-11-05', toDate: '2026-11-05', timezone: 'UTC',
    });
    expect(hourly[12].orders).toBe(5);
    const byKey = Object.fromEntries(dayparts.map((d) => [d.key, d]));
    expect(byKey.breakfast.orders).toBe(2);
    expect(byKey.lunch.orders).toBe(5);
    expect(byKey.dinner.orders).toBe(6);
    expect(byKey.late_night.orders).toBe(1);
    expect(byKey.other.orders).toBe(0);
  });

  test('prime cost adds labor and actual food cost over the same period (hand-checked)', async () => {
    // Food totals: net 100.00, actual food 32.50. Labor (mocked): 100.00.
    // Prime = 132.50 on 500.00 revenue = 26.5%.
    mockQuery.mockResolvedValueOnce({ rows: [{
      net_sales_cents: 10000, theoretical_cost_major: '30.00', actual_cost_major: '32.50',
    }] });
    mockQuery.mockResolvedValueOnce({ rows: [] });
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const prime = await computePrimeCost({
      restaurant: { id: 3, business_id: 42, timezone: 'UTC', currency_code: 'USD' },
      fromDate: '2026-11-05', toDate: '2026-11-05', db: client,
    });
    expect(prime.currency).toBe('USD');
    expect(prime.labor.labor_cost_cents).toBe(10000);
    expect(prime.food.actual_cost_cents).toBe(3250);
    expect(prime.prime_cost_cents).toBe(13250);
    expect(prime.prime_cost_pct).toBe(26.5);
    expect(prime.food.actual_cost_pct).toBe(32.5);
  });
});

describe('Phase 7: rollup cache staleness (gap 20)', () => {
  test('second read inside the TTL reuses the cached payload; TTL is 900s', async () => {
    const compute = jest.fn(async () => ({ totals: { currency: 'USD', labor_cost_cents: 100 }, stores: [] }));
    mockQuery.mockResolvedValueOnce({ rows: [] });
    mockQuery.mockResolvedValueOnce({ rows: [{ computed_at: '2026-11-06T10:00:00Z', expires_at: '2026-11-06T10:15:00Z' }] });
    const first = await getCachedRollup(client, {
      restaurantId: 3, locationId: null, fromDate: '2026-11-05', toDate: '2026-11-05', kind: 'hq_labor', compute,
    });
    expect(first.is_cached).toBe(false);
    expect(first.stale_after_seconds).toBe(900);
    expect(ROLLUP_TTL_SECONDS).toBe(900);
    expect(compute).toHaveBeenCalledTimes(1);
    mockQuery.mockResolvedValueOnce({ rows: [{ payload: { totals: { currency: 'USD', labor_cost_cents: 100 }, stores: [] }, computed_at: '2026-11-06T10:00:00Z', expires_at: '2026-11-06T10:15:00Z' }] });
    const second = await getCachedRollup(client, {
      restaurantId: 3, locationId: null, fromDate: '2026-11-05', toDate: '2026-11-05', kind: 'hq_labor', compute,
    });
    expect(second.is_cached).toBe(true);
    expect(second.payload.totals.labor_cost_cents).toBe(100);
    expect(compute).toHaveBeenCalledTimes(1);
  });

  test('a cached row whose payload is not a rollup is treated as a miss and recomputed', async () => {
    // Regression: the HQ test mocks pool.query to return location
    // rows for every query, so the cache SELECT once "found" a row
    // with no payload at all and the endpoint served a body with no
    // stores/totals. A malformed row must never be served.
    const compute = jest.fn(async () => ({ totals: { currency: 'USD', labor_cost_cents: 100 }, stores: [] }));
    mockQuery.mockResolvedValueOnce({ rows: [{ payload: { id: 1, display_name: 'Downtown' }, computed_at: '2026-11-06T10:00:00Z', expires_at: '2026-11-06T10:15:00Z' }] });
    mockQuery.mockResolvedValueOnce({ rows: [{}] });
    const result = await getCachedRollup(client, {
      restaurantId: 3, locationId: null, fromDate: '2026-11-05', toDate: '2026-11-05', kind: 'hq_labor', compute,
    });
    expect(compute).toHaveBeenCalledTimes(1);
    expect(result.is_cached).toBe(false);
    expect(result.payload.totals.labor_cost_cents).toBe(100);
    expect(typeof result.computed_at).toBe('string');
  });
});

describe('Phase 7: scheduled delivery (gap 19)', () => {
  test('a delivered report is stamped as-of, snapshot, never a locked close', async () => {
    const payload = await scheduledReports.buildScheduledReport(client, {
      restaurant: { id: 3, business_id: 42, timezone: 'UTC', currency_code: 'USD' },
      schedule: { id: 1, restaurant_id: 3, location_id: null, report_type: 'daily_close', frequency: 'daily' },
      businessDate: '2026-11-05',
      asOf: new Date('2026-11-06T10:00:00Z'),
    });
    expect(payload.as_of).toBe('2026-11-06T10:00:00.000Z');
    expect(payload.snapshot).toBe(true);
    expect(payload.locked_close).toBe(false);
    expect(payload.business_date).toBe('2026-11-05');
  });

  test('a second run for the same business day replays instead of sending twice', async () => {
    const now = new Date('2026-11-06T10:00:00Z');
    mockQuery.mockResolvedValueOnce({ rows: [{
      id: 1, restaurant_id: 3, business_id: 42, timezone: 'UTC', currency_code: 'USD',
      location_id: null, report_type: 'labor', frequency: 'daily', delivery_channel: 'in_app',
      recipients: [{ user_id: USER_ID }], last_business_date: null,
    }] });
    // Ledger insert: ON CONFLICT DO NOTHING returns no row (already delivered).
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const result = await scheduledReports.runDueScheduledReports(client, { now });
    expect(result.due).toBe(1);
    expect(result.skipped).toBe(1);
    expect(result.sent).toBe(0);
    expect(sendNotification).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
  });

  test('an invalid schedule is rejected before any delivery', () => {
    expect(() => scheduledReports.validateScheduleInput({ reportType: 'custom_builder' }))
      .toThrow(/Unknown report type/);
    expect(() => scheduledReports.validateScheduleInput({ reportType: 'labor', deliveryChannel: 'email', recipients: [] }))
      .toThrow(/at least one recipient email/);
  });
});

describe('Phase 7: retention policy + anonymization (gap 21)', () => {
  test('no stored row means the 7-year default', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const policy = await retention.getRetentionPolicy(client, { restaurantId: 3, recordClass: 'time_entries' });
    expect(policy.retention_years).toBe(7);
    expect(policy.source).toBe('default');
    expect(retention.DEFAULT_RETENTION_YEARS).toBe(7);
  });

  test('retention years outside 1-30 and unknown classes are rejected', async () => {
    await expect(retention.setRetentionPolicy(client, { restaurantId: 3, recordClass: 'time_entries', retentionYears: 0 }))
      .rejects.toMatchObject({ status: 400 });
    await expect(retention.setRetentionPolicy(client, { restaurantId: 3, recordClass: 'secrets', retentionYears: 7 }))
      .rejects.toMatchObject({ status: 400 });
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test('a jurisdiction row only wins for its own jurisdiction_code', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ retention_years: 10, jurisdiction_code: 'US-CA', source: 'jurisdiction', location_id: null }] });
    const policy = await retention.getRetentionPolicy(client, { restaurantId: 3, recordClass: 'time_entries', jurisdictionCode: 'US-CA' });
    expect(policy.retention_years).toBe(10);
    expect(policy.source).toBe('jurisdiction');
    const [sql, params] = mockQuery.mock.calls[0];
    expect(String(sql)).toContain('jurisdiction_code');
    expect(params).toContain('US-CA');
    // A non-matching code must not let the jurisdiction row win: the
    // lookup asks the database for matching-code rows only, so the
    // operator row is what comes back.
    mockQuery.mockResolvedValueOnce({ rows: [{ retention_years: 5, jurisdiction_code: null, source: 'operator', location_id: null }] });
    const other = await retention.getRetentionPolicy(client, { restaurantId: 3, recordClass: 'time_entries', jurisdictionCode: 'US-NY' });
    expect(other.retention_years).toBe(5);
    expect(other.source).toBe('operator');
    const [, otherParams] = mockQuery.mock.calls[1];
    expect(otherParams).toContain('US-NY');
  });

  test('anonymization never deletes history rows and skips unexpired retention', async () => {
    const skipped = await retention.anonymizeFormerStaff(client, {
      businessId: 42, restaurantId: 3, userId: USER_ID, retainUntil: '2033-01-01',
    });
    expect(skipped.skipped).toBe(true);
    expect(mockQuery).not.toHaveBeenCalled();
    // Finding 12: no retention deadline refuses the erasure outright.
    const noGate = await retention.anonymizeFormerStaff(client, {
      businessId: 42, restaurantId: 3, userId: USER_ID,
    });
    expect(noGate).toEqual({ skipped: true, reason: 'retention_not_established', retain_until: null });
    expect(mockQuery).not.toHaveBeenCalled();
    // Query order: name lookup, documents (one UPDATE ... RETURNING),
    // orphaned storage keys (#40: soft-deleted docs with no queue
    // row), time-entry notes, pay-run labels, time-entry edits (one
    // combined pass for all name parts, Domain 9 item 4), audit JSON
    // (one combined pass for all needles), labor profile, history.
    mockQuery.mockResolvedValueOnce({ rows: [{ first_name: 'Phase', last_name: 'Staff' }] });
    mockQuery.mockResolvedValueOnce({ rows: [] });
    mockQuery.mockResolvedValueOnce({ rows: [] });
    mockQuery.mockResolvedValueOnce({ rowCount: 2 });
    mockQuery.mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 11 }] });
    mockQuery.mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 21 }] });
    mockQuery.mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 31 }] });
    mockQuery.mockResolvedValueOnce({ rowCount: 1 });
    mockQuery.mockResolvedValueOnce({ rows: [{ retained: 5 }] });
    const outcome = await retention.anonymizeFormerStaff(client, {
      businessId: 42, restaurantId: 3, userId: USER_ID, retainUntil: '2020-01-01',
    });
    expect(outcome.skipped).toBe(false);
    expect(outcome.time_entry_notes_cleared).toBe(2);
    expect(outcome.pay_run_labels_cleared).toBe(1);
    expect(outcome.time_entry_edits_scrubbed).toBe(1);
    // The same audit row matched the full-name and the quoted
    // first-name needles; it is one scrubbed row, not two.
    expect(outcome.audit_names_scrubbed).toBe(1);
    expect(outcome.labor_profile_removed).toBe(1);
    expect(outcome.history_rows_retained).toBe(5);
    expect(mockQuery.mock.calls.flatMap((c) => c[1] || [])).toContain('Former staff');
    const sql = mockQuery.mock.calls.map((c) => String(c[0])).join('\n');
    expect(sql).toMatch(/UPDATE restaurant_pay_run_lines/);
    expect(sql).toMatch(/UPDATE business_time_entry_edits/);
    expect(sql).toMatch(/UPDATE business_audit_log/);
    // Finding 60: the labor-profile delete honors minor_until.
    expect(sql).toMatch(/minor_until/);
    expect(sql).not.toMatch(/DELETE FROM business_time_entries/);
    expect(sql).not.toMatch(/DELETE FROM business_staff_shifts/);
    expect(sql).not.toMatch(/DELETE FROM business_staff_schedule_changes/);
    expect(sql).not.toMatch(/DELETE FROM restaurant_pay_run_lines/);
    expect(sql).not.toMatch(/DELETE FROM business_audit_log/);
  });
});

describe('Phase 7: KDS feed rate limit (gap 20)', () => {
  function feedApp(userId) {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { req.user = { id: userId }; next(); });
    app.get('/:restaurantId/kitchen/feed', kitchenFeedLimiter, (req, res) => res.status(200).json({ ok: true }));
    app.use(errorHandler);
    return app;
  }

  test('30 polls per minute pass, the 31st is 429, another consumer is unaffected', async () => {
    const app = feedApp('00000000-0000-4000-8000-000000000201');
    for (let i = 0; i < 30; i++) {
      expect((await request(app).get('/3/kitchen/feed')).status).toBe(200);
    }
    const blocked = await request(app).get('/3/kitchen/feed');
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
    const otherRes = await request(feedApp('00000000-0000-4000-8000-000000000202')).get('/3/kitchen/feed');
    expect(otherRes.status).toBe(200);
  });
});
