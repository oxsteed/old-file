'use strict';

/**
 * DB tests: Phase 1 pay correctness (goal_a0fc7c0f0394) end to end
 * through computeLabor against a real migrated database.
 *
 * Proves, with hand-checked numbers:
 *   - a California week computes correctly: an 11-hour Monday pays
 *     8 regular + 3 daily overtime, a 40-hour-plus week converts
 *     regular hours past the 40h threshold to overtime, a missed meal
 *     break adds one hour at the regular rate, and a predictability
 *     premium recorded on a schedule change lands on the pay line;
 *   - the same code under a GB-UK jurisdiction row pays the same
 *     11-hour shift as straight time (no daily overtime rule) in the
 *     location's own currency (GBP);
 *   - per-location labor policy and jurisdiction resolve through the
 *     database (location row wins over the restaurant fallback).
 *
 * The California fixture's currency is USD in the fixture data
 * (a California restaurant pays in USD); the GB fixture's is GBP.
 * No code path assumes either: the currency always arrives with the
 * location/restaurant data.
 *
 * Run with:
*   STATEMENT_TEST_DATABASE_URL=<redacted>
 *     npx jest __tests__/restaurantPayrollPhase1.db.test.js
 * Without it, the DB describes skip (fail closed).
 */
jest.unmock('pg');

const crypto = require('crypto');

function isDisposableDb(value) {
  try {
    const url = new URL(value);
    return ['postgres:', 'postgresql:'].includes(url.protocol)
      && ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(url.hostname)
      && ['/st_t6'].includes(url.pathname);
  } catch { return false; }
}
const RAW_URL = process.env.STATEMENT_TEST_DATABASE_URL || '';
if (RAW_URL && !isDisposableDb(RAW_URL)) {
  throw new Error('Payroll DB tests require an explicit loopback disposable database');
}
const CAN_RUN_DB = isDisposableDb(RAW_URL);
const ddescribe = CAN_RUN_DB ? describe : describe.skip;

test('suite targets only a disposable loopback database', () => {
  expect(isDisposableDb(RAW_URL)).toBe(CAN_RUN_DB);
});

if (CAN_RUN_DB) {
process.env.DATABASE_URL=<redacted>
  process.env.NODE_ENV = 'test';
  process.env.LOG_LEVEL = 'error';
}

const pool = require('../db');
const payrollService = require('../services/restaurantPayrollService');

async function makeUser(first, last) {
  const id = crypto.randomUUID();
  const tag = crypto.randomUUID().slice(0, 8);
  await pool.query(
    `INSERT INTO users (id, email, password_hash, first_name, last_name, role, email_verified, is_active)
     VALUES ($1, $2, 'x', $3, $4, 'customer', TRUE, TRUE)`,
    [id, `phase1-${tag}@example.invalid`, first, last]
  );
  return id;
}

async function addLocation(restaurantId, name, { country, state, timezone, currency }) {
  const { rows: [loc] } = await pool.query(
    `INSERT INTO restaurant_locations
       (restaurant_id, name, address_country, address_state, timezone, currency_code, is_primary)
     VALUES ($1, $2, $3, $4, $5, $6, FALSE) RETURNING id`,
    [restaurantId, name, country, state, timezone, currency]
  );
  return loc.id;
}

async function addTimeEntry(businessId, userId, locationId, date, hours, breaks) {
  await pool.query(
    `INSERT INTO business_time_entries
       (business_id, user_id, entry_date, hours_worked, breaks, clock_in_at, clock_out_at, location_id)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8)`,
    [businessId, userId, date, hours, JSON.stringify(breaks || []),
      `${date}T09:00:00-07:00`, `${date}T20:00:00-07:00`, locationId]
  );
}

const BREAK_30 = [{ started_at: '2026-11-02T12:00:00Z', ended_at: '2026-11-02T12:30:00Z' }];
const RANGE = { from: '2026-11-02', to: '2026-11-07' };

ddescribe('Phase 1: California pay period end to end', () => {
  let fx;

  beforeAll(async () => {
    const owner = await makeUser('Olivia', 'Owner');
    const { rows: [b] } = await pool.query(
      'INSERT INTO businesses (user_id, business_name) VALUES ($1, $2) RETURNING id',
      [owner, 'Phase 1 Bistro']
    );
    const businessId = b.id;
    const { rows: [r] } = await pool.query(
      `INSERT INTO food_restaurants (business_id, owner_user_id, display_name, timezone, currency_code)
       VALUES ($1, $2, $3, 'America/Los_Angeles', 'USD') RETURNING id`,
      [businessId, owner, 'Phase 1 Bistro']
    );
    const restaurantId = r.id;
    const caLocationId = await addLocation(restaurantId, 'Los Angeles', {
      country: 'US', state: 'CA', timezone: 'America/Los_Angeles', currency: 'USD',
    });
    const gbLocationId = await addLocation(restaurantId, 'London', {
      country: 'GB', state: 'London', timezone: 'Europe/London', currency: 'GBP',
    });

    // Jurisdictions: US-CA for Los Angeles, GB-UK for London. The
    // presets supply the rule values; the rows only pick the code.
    await pool.query(
      `INSERT INTO restaurant_labor_jurisdictions (restaurant_id, location_id, jurisdiction_code)
       VALUES ($1, $2, 'US-CA'), ($1, $3, 'GB-UK')`,
      [restaurantId, caLocationId, gbLocationId]
    );
    // Per-location labor policy for Los Angeles (40h week, CA break
    // point 300 min); London keeps the restaurant fallback.
    await pool.query(
      `INSERT INTO restaurant_location_labor_policies
         (restaurant_id, location_id, overtime_threshold_hours, overtime_multiplier_bps,
          break_after_minutes, break_duration_minutes, country_code, region_code)
       VALUES ($1, $2, 40, 15000, 300, 30, 'US', 'CA')`,
      [restaurantId, caLocationId]
    );

    const ana = await makeUser('Ana', 'Alvarez');
    const ben = await makeUser('Ben', 'Baker');
    const { rows: [anaMembership] } = await pool.query(
      `INSERT INTO business_members (business_id, owner_id, member_id, role, invite_email, status, job_role, hourly_wage_cents)
       VALUES ($1, $2, $3, 'employee', $4, 'active', 'Cook', 2000) RETURNING id`,
      [businessId, owner, ana, `member-${ana.slice(0, 8)}@example.invalid`]
    );
    const { rows: [benMembership] } = await pool.query(
      `INSERT INTO business_members (business_id, owner_id, member_id, role, invite_email, status, job_role, hourly_wage_cents)
       VALUES ($1, $2, $3, 'employee', $4, 'active', 'Cook', 1800) RETURNING id`,
      [businessId, owner, ben, `member-${ben.slice(0, 8)}@example.invalid`]
    );
    await pool.query(
      `INSERT INTO restaurant_location_memberships (restaurant_id, location_id, membership_id, status)
       VALUES ($1, $2, $3, 'active'), ($1, $4, $5, 'active')`,
      [restaurantId, caLocationId, anaMembership.id, gbLocationId, benMembership.id]
    );

    // Ana (CA): Mon 11h with no break, Tue-Sat 8h with a 30-min break.
    // Hand-check: Mon 8 regular + 3 daily OT + 1 missed meal (1h
    // premium). Week total 51h; regular hours 8 + 40 = 48, weekly
    // threshold 40 -> 8 more OT. Regular 40, OT 11, double 0.
    // Wages: 40 x 2000 + 11 x 3000 = 113,000; meal premium 2,000.
    await addTimeEntry(businessId, ana, caLocationId, '2026-11-02', 11, []);
    for (const date of ['2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07']) {
      await addTimeEntry(businessId, ana, caLocationId, date, 8, BREAK_30);
    }
    // Ben (GB-UK): Mon 11h with no break. No daily OT rule, so 11
    // regular; the missed meal break is counted but earns no premium.
    await addTimeEntry(businessId, ben, gbLocationId, '2026-11-02', 11, []);

    // Ana's predictability premium: a published shift changed inside
    // the notice window, recorded with the amount at change time (1h x
    // 2000). The location carried a CUSTOM notice rule at change time,
    // so the recorded jurisdiction is CUSTOM; payroll consumes the
    // recorded flag and amount, not the code.
    await pool.query(
      `INSERT INTO business_staff_schedule_changes
         (business_id, shift_id, user_id, restaurant_id, location_id, change_type,
          before_state, after_state, hours_before_start, notice_hours, jurisdiction_code,
          employee_requested, premium_due, premium_hours, premium_cents, premium_currency_code, created_at)
       VALUES ($1, 1, $2, $3, $4, 'edited',
          '{"shift_date":"2026-11-06","start_time":"09:00","end_time":"17:00"}'::jsonb,
          '{"shift_date":"2026-11-06","start_time":"12:00","end_time":"17:00"}'::jsonb,
          48, 336, 'CUSTOM', FALSE, TRUE, 1, 2000, 'USD', '2026-11-04T12:00:00Z')`,
      [businessId, ana, restaurantId, caLocationId]
    );

    fx = { businessId, restaurantId, caLocationId, gbLocationId, ana, ben };
  });

  test('the California week pays daily OT, weekly OT, meal and predictability premiums', async () => {
    const labor = await payrollService.computeLabor({
      restaurant: { id: fx.restaurantId, business_id: fx.businessId, currency_code: 'USD', timezone: 'America/Los_Angeles' },
      fromDate: RANGE.from, toDate: RANGE.to, locationIds: [fx.caLocationId],
    });
    expect(labor.currency).toBe('USD');
    expect(labor.currency_minor_unit_decimals).toBe(2);
    const ana = labor.employees.find((e) => e.user_id === fx.ana);
    expect(ana).toBeDefined();
    expect(ana.hours).toBe(51);
    expect(ana.regular_hours).toBe(40);
    expect(ana.overtime_hours).toBe(11);
    expect(ana.doubletime_hours).toBe(0);
    expect(ana.regular_wages_cents).toBe(80000);
    expect(ana.overtime_wages_cents).toBe(33000);
    expect(ana.wages_cents).toBe(113000);
    expect(ana.missed_meal_breaks).toBe(1);
    expect(ana.meal_break_premium_hours).toBe(1);
    expect(ana.meal_break_premium_cents).toBe(2000);
    expect(ana.predictability_premium_hours).toBe(1);
    expect(ana.predictability_premium_cents).toBe(2000);
    expect(ana.unpriced_premium_hours).toBe(0);
    expect(ana.total_pay_cents).toBe(117000);
    expect(labor.labor_policy.location_id).toBe(fx.caLocationId);
    expect(labor.labor_policy.country_code).toBe('US');
    expect(labor.labor_policy.region_code).toBe('CA');
    expect(labor.overtime_hours).toBe(11);
    expect(labor.meal_break_premium_cents).toBe(2000);
    expect(labor.predictability_premium_cents).toBe(2000);
    // The CSV carries the new pay lines.
    const csv = payrollService.buildPayrollCsv(labor);
    expect(csv).toContain('doubletime_hours');
    expect(csv).toContain('predictability_premium_cents');
  });

  test('the London store under GB-UK pays the same 11 hours as straight time, in GBP', async () => {
    const labor = await payrollService.computeLabor({
      restaurant: { id: fx.restaurantId, business_id: fx.businessId, currency_code: 'USD', timezone: 'Europe/London' },
      fromDate: RANGE.from, toDate: RANGE.to, locationIds: [fx.gbLocationId],
    });
    expect(labor.currency).toBe('GBP');
    const ben = labor.employees.find((e) => e.user_id === fx.ben);
    expect(ben).toBeDefined();
    expect(ben.hours).toBe(11);
    expect(ben.regular_hours).toBe(11);
    expect(ben.overtime_hours).toBe(0);
    expect(ben.doubletime_hours).toBe(0);
    expect(ben.wages_cents).toBe(19800);
    expect(ben.missed_meal_breaks).toBe(1);
    expect(ben.meal_break_premium_cents).toBe(0);
    expect(ben.total_pay_cents).toBe(19800);
    // London has no per-location policy row: the restaurant fallback.
    expect(labor.labor_policy.location_id).toBe(null);
  });

  test('getLaborPolicy resolves per location from the database', async () => {
    const ca = await payrollService.getLaborPolicy(fx.restaurantId, fx.caLocationId);
    expect(ca.location_id).toBe(fx.caLocationId);
    expect(ca.overtime_threshold_hours).toBe(40);
    expect(ca.break_after_minutes).toBe(300);
    const gb = await payrollService.getLaborPolicy(fx.restaurantId, fx.gbLocationId);
    expect(gb.location_id).toBe(null);
    expect(gb.overtime_threshold_hours).toBe(40);
  });
});
