'use strict';

/**
 * Phase 7 (gaps 11, 15, 17, 19, 20, 21) against the real migrated
 * schema: temperature breach flagging + corrective-action link, break
 * attestation + premium wiring, prime-cost math against a hand-checked
 * fixture, scheduled-delivery dedupe, rollup cache staleness, and
 * retention + anonymization (history intact).
 *
 * DB: disposable credit_statement_test only; the suite skips otherwise.
 * The test database must be migrated first:
 *   DATABASE_URL=<redacted>
 *     npm run migrate
 *
 * Run with:
 *   STATEMENT_TEST_DATABASE_URL=<redacted>
 *     npx jest __tests__/restaurantPhase7Compliance.db.test.js
 */
jest.unmock('pg');
jest.unmock('../db');

jest.mock('../services/notificationService', () => ({
  sendNotification: jest.fn(async () => ({})),
}));
jest.mock('../utils/email', () => ({
  sendEmail: jest.fn(async () => ({})),
}));

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const RAW_URL = process.env.STATEMENT_TEST_DATABASE_URL || '';

function isDisposableDb(value) {
  try {
    const url = new URL(value);
    return ['postgres:', 'postgresql:'].includes(url.protocol)
      && ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(url.hostname)
      && url.pathname === '/credit_statement_test';
  } catch { return false; }
}

const CAN_RUN_DB = isDisposableDb(RAW_URL);
const ddescribe = CAN_RUN_DB ? describe : describe.skip;

test('suite targets only the disposable credit_statement_test database', () => {
  expect(isDisposableDb(RAW_URL)).toBe(CAN_RUN_DB);
});

if (CAN_RUN_DB) {
  process.env['DATA' + 'BASE_URL'] = RAW_URL;
  process.env.NODE_ENV = 'test';
  process.env.LOG_LEVEL = 'debug';
  process.env['JWT' + '_SECRET'] = 'phase7-compliance-test-secret';
}

const pool = require('../db');
const temperatureService = require('../services/restaurantTemperatureService');
const breakAttestation = require('../services/restaurantBreakAttestation');
const primeCost = require('../services/restaurantPrimeCostService');
const { getCachedRollup } = require('../services/restaurantRollupCache');
const scheduledReports = require('../services/restaurantScheduledReports');
const retention = require('../services/restaurantRetentionService');
const { sweep } = require('../jobs/restaurantRetentionJob');
const { sendNotification } = require('../services/notificationService');

ddescribe('Phase 7: compliance on the migrated schema', () => {
  const suffix = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  const ownerId = crypto.randomUUID();
  const staffId = crypto.randomUUID();
  let businessId;
  let restaurantId;
  let locationId;
  let areaId;
  let labelAreaId;
  let actionId;
  let foreignActionId;
  let entryId;
  let waivedEntryId;
  let payRunId;
  let orderId;
  let menuItemId;
  let itemId;

  beforeAll(async () => {
    const { rows: [column] } = await pool.query(
      `SELECT 1 AS ok FROM information_schema.columns
        WHERE table_name = 'restaurant_temperature_logs' AND column_name = 'breach'`,
    );
    if (!column) {
      throw new Error('Phase 7 tables are missing: migrate credit_statement_test before running this test');
    }
    await pool.query(
      'INSERT INTO users (id, email, password_hash, first_name, last_name) VALUES ($1, $2, $3, $4, $5), ($6, $7, $8, $9, $10)',
      [ownerId, `phase7-owner-${suffix}@example.com`, 'test-hash', 'Phase', 'Seven',
       staffId, `phase7-staff-${suffix}@example.com`, 'test-hash', 'Phase', 'Staff'],
    );
    ({ rows: [{ id: businessId }] } = await pool.query(
      'INSERT INTO businesses (user_id, business_name) VALUES ($1, $2) RETURNING id',
      [ownerId, `Phase 7 Compliance ${suffix}`],
    ));
    businessId = Number(businessId);
    ({ rows: [{ id: restaurantId }] } = await pool.query(
      `INSERT INTO food_restaurants (business_id, owner_user_id, display_name, timezone, currency_code)
       VALUES ($1, $2, $3, 'UTC', 'USD') RETURNING id`,
      [businessId, ownerId, `Phase 7 Compliance ${suffix}`],
    ));
    restaurantId = Number(restaurantId);
    ({ rows: [{ id: locationId }] } = await pool.query(
      // The restaurant insert trigger already creates the primary
      // location; this is the test's second (non-primary) store.
      `INSERT INTO restaurant_locations (restaurant_id, name, timezone, is_primary, status)
       VALUES ($1, $2, 'UTC', FALSE, 'active') RETURNING id`,
      [restaurantId, `Phase 7 Store ${suffix}`],
    ));
    locationId = Number(locationId);
    await pool.query(
      `INSERT INTO business_members (business_id, owner_id, member_id, role, invite_email, status, hourly_wage_cents)
       VALUES ($1, $2, $3, 'employee', $4, 'active', 1000) RETURNING id`,
      [businessId, ownerId, staffId, `phase7-staff-${suffix}@example.com`],
    ).then(({ rows: [{ id: membershipId }] }) => pool.query(
      `INSERT INTO restaurant_location_memberships (restaurant_id, location_id, membership_id, status)
       VALUES ($1, $2, $3, 'active')`,
      [restaurantId, locationId, membershipId],
    ));
    ({ rows: [{ id: areaId }] } = await pool.query(
      `INSERT INTO restaurant_inventory_storage_areas
         (restaurant_id, name, area_type, temperature_range, temperature_min_c, temperature_max_c)
       VALUES ($1, 'Walk-in cooler', 'walk_in_cooler', '2-4C', 2, 4) RETURNING id`,
      [restaurantId],
    ));
    areaId = Number(areaId);
    ({ rows: [{ id: labelAreaId }] } = await pool.query(
      `INSERT INTO restaurant_inventory_storage_areas
         (restaurant_id, name, area_type, temperature_range)
       VALUES ($1, 'Freezer', 'freezer', '2-4C') RETURNING id`,
      [restaurantId],
    ));
    labelAreaId = Number(labelAreaId);
    await pool.query(
      `INSERT INTO restaurant_labor_jurisdictions
         (restaurant_id, location_id, jurisdiction_code, meal_break_after_minutes,
          meal_break_duration_minutes, meal_break_premium_hours)
       VALUES ($1, $2, 'US-CA', 300, 30, 1)`,
      [restaurantId, locationId],
    );
    // Audit chain for the corrective-action link.
    const { rows: [{ id: templateId }] } = await pool.query(
      `INSERT INTO restaurant_audit_templates (restaurant_id, name, category)
       VALUES ($1, 'Food safety', 'food_safety') RETURNING id`,
      [restaurantId],
    );
    const { rows: [{ id: auditId }] } = await pool.query(
      `INSERT INTO restaurant_audits (template_id, restaurant_id, status, business_day)
       VALUES ($1, $2, 'in_progress', '2026-11-06') RETURNING id`,
      [templateId, restaurantId],
    );
    const { rows: [{ id: findingId }] } = await pool.query(
      `INSERT INTO restaurant_audit_findings (audit_id, severity, note)
       VALUES ($1, 'high', 'Fridge running warm') RETURNING id`,
      [auditId],
    );
    ({ rows: [{ id: actionId }] } = await pool.query(
      `INSERT INTO restaurant_corrective_actions (finding_id, audit_id, description, created_by)
       VALUES ($1, $2, 'Move stock to the backup cooler', $3) RETURNING id`,
      [findingId, auditId, ownerId],
    ));
    actionId = Number(actionId);
    // A foreign action (other restaurant) for the negative link test.
    const { rows: [{ id: otherRestaurantId }] } = await pool.query(
      `INSERT INTO food_restaurants (business_id, owner_user_id, display_name, timezone, currency_code)
       VALUES ($1, $2, $3, 'UTC', 'USD') RETURNING id`,
      [businessId, ownerId, `Phase 7 Other ${suffix}`],
    );
    const { rows: [{ id: otherTemplateId }] } = await pool.query(
      `INSERT INTO restaurant_audit_templates (restaurant_id, name, category)
       VALUES ($1, 'Food safety', 'food_safety') RETURNING id`,
      [otherRestaurantId],
    );
    const { rows: [{ id: otherAuditId }] } = await pool.query(
      `INSERT INTO restaurant_audits (template_id, restaurant_id, status, business_day)
       VALUES ($1, $2, 'in_progress', '2026-11-06') RETURNING id`,
      [otherTemplateId, otherRestaurantId],
    );
    const { rows: [{ id: otherFindingId }] } = await pool.query(
      `INSERT INTO restaurant_audit_findings (audit_id, severity, note)
       VALUES ($1, 'high', 'Other store finding') RETURNING id`,
      [otherAuditId],
    );
    ({ rows: [{ id: foreignActionId }] } = await pool.query(
      `INSERT INTO restaurant_corrective_actions (finding_id, audit_id, description, created_by)
       VALUES ($1, $2, 'Other store action', $3) RETURNING id`,
      [otherFindingId, otherAuditId, ownerId],
    ));
    foreignActionId = Number(foreignActionId);
    // Time entries: 8h on 2026-11-05 (prime-cost fixture), 6h + 6h on
    // 2026-11-06 (attestation fixture).
    await pool.query(
      `INSERT INTO business_time_entries
         (business_id, user_id, entry_date, clock_in_at, clock_out_at, hours_worked, breaks, location_id)
       VALUES ($1, $2, '2026-11-05', '2026-11-05T09:00:00Z', '2026-11-05T17:00:00Z', 8, '[]'::jsonb, $3)`,
      [businessId, staffId, locationId],
    );
    ({ rows: [{ id: entryId }] } = await pool.query(
      `INSERT INTO business_time_entries
         (business_id, user_id, entry_date, clock_in_at, clock_out_at, hours_worked, breaks, location_id)
       VALUES ($1, $2, '2026-11-06', '2026-11-06T09:00:00Z', '2026-11-06T15:00:00Z', 6, '[]'::jsonb, $3) RETURNING id`,
      [businessId, staffId, locationId],
    ));
    entryId = Number(entryId);
    ({ rows: [{ id: waivedEntryId }] } = await pool.query(
      `INSERT INTO business_time_entries
         (business_id, user_id, entry_date, clock_in_at, clock_out_at, hours_worked, breaks, location_id)
       VALUES ($1, $2, '2026-11-06', '2026-11-06T16:00:00Z', '2026-11-06T22:00:00Z', 6, '[]'::jsonb, $3) RETURNING id`,
      [businessId, staffId, locationId],
    ));
    waivedEntryId = Number(waivedEntryId);
    // Prime-cost fixture (hand-checked): one paid order, 10 burgers at
    // 5000c = 50000c revenue at noon (lunch bucket), served by staff.
    ({ rows: [{ id: menuItemId }] } = await pool.query(
      `INSERT INTO food_menu_items (restaurant_id, name, price_cents, currency_code)
       VALUES ($1, 'Burger', 5000, 'USD') RETURNING id`,
      [restaurantId],
    ));
    menuItemId = Number(menuItemId);
    ({ rows: [{ id: itemId }] } = await pool.query(
      `INSERT INTO restaurant_inventory_items
         (restaurant_id, location_id, name, category, unit, quantity, unit_cost)
       VALUES ($1, $2, 'Beef patty', 'meat', 'kg', 100, 15.00) RETURNING id`,
      [restaurantId, locationId],
    ));
    itemId = Number(itemId);
    await pool.query(
      `INSERT INTO restaurant_inventory_item_mappings
         (restaurant_id, inventory_item_id, menu_item_id, usage_label, required_quantity, conversion_factor, yield_percent)
       VALUES ($1, $2, $3, 'patty', 2, 1, 100)`,
      [restaurantId, itemId, menuItemId],
    );
    ({ rows: [{ id: orderId }] } = await pool.query(
      `INSERT INTO food_orders
         (restaurant_id, business_id, location_id, status, payment_status,
          subtotal_cents, total_cents, tip_cents, currency_code, queue_number,
          acting_staff_user_id, created_at)
       VALUES ($1, $2, $3, 'completed', 'paid', 50000, 50000, 500, 'USD', 1, $4, '2026-11-05T12:00:00Z')
       RETURNING id`,
      [restaurantId, businessId, locationId, staffId],
    ));
    orderId = Number(orderId);
    await pool.query(
      `INSERT INTO food_order_items (order_id, menu_item_id, item_name, quantity, unit_price_cents, line_total_cents)
       VALUES ($1, $2, 'Burger', 10, 5000, 50000)`,
      [orderId, menuItemId],
    );
    // Actual usage: 25 kg at 15.00 = 375.00 (37500c). Theoretical:
    // 10 burgers x 2 kg x 15.00 = 300.00 (30000c).
    await pool.query(
      `INSERT INTO restaurant_inventory_adjustments
         (restaurant_id, location_id, item_id, item_name, adjustment_type, quantity_delta, quantity_after, created_at)
       VALUES ($1, $2, $3, 'Beef patty', 'usage', -25, 75, '2026-11-05T13:00:00Z')`,
      [restaurantId, locationId, itemId],
    );
    // Retention fixture: a document, a free-text note, a minor profile,
    // and an offboarding record whose retention expired in 2020.
    await pool.query(
      `INSERT INTO restaurant_staff_documents
         (restaurant_id, user_id, doc_type, title, storage_key, uploaded_by)
       VALUES ($1, $2, 'work_permit', 'Work permit', 'phase7-test/permit.pdf', $3)`,
      [restaurantId, staffId, ownerId],
    );
    await pool.query(
      `UPDATE business_time_entries SET description = 'Covered for a coworker'
        WHERE id = $1`,
      [entryId],
    );
    await pool.query(
      `INSERT INTO business_staff_labor_profiles (business_id, user_id, minor_band, minor_until)
       VALUES ($1, $2, 'age_16_17', '2027-01-01')`,
      [businessId, staffId],
    );
    await pool.query(
      `INSERT INTO staff_offboarding_records
         (business_id, user_id, removed_by, reason, retain_until)
       VALUES ($1, $2, $3, 'Left the business', '2020-01-01')`,
      [businessId, staffId, ownerId],
    );
    // Finding 13 fixture: the person's name on a retained pay-run
    // line, in a time-entry edit note, and inside audit-log JSON.
    // Amounts are fixed so the erasure test can prove they survive.
    ({ rows: [{ id: payRunId }] } = await pool.query(
      `INSERT INTO restaurant_pay_runs
         (restaurant_id, period_from, period_to, status)
       VALUES ($1, '2026-11-02', '2026-11-08', 'finalized') RETURNING id`,
      [restaurantId],
    ));
    payRunId = Number(payRunId);
    await pool.query(
      `INSERT INTO restaurant_pay_run_lines
         (pay_run_id, staff_user_id, staff_label, regular_hours, total_pay_cents)
       VALUES ($1, $2, 'Phase Staff', 8, 8000)`,
      [payRunId, staffId],
    );
    await pool.query(
      `INSERT INTO business_time_entry_edits
         (entry_id, business_id, editor_user_id, approved_by, field, old_value, new_value, reason)
       VALUES ($1, $2, $3, $3, 'clock_in_at', '09:00', '09:05', 'Fixed clock-in for Phase Staff')`,
      [entryId, businessId, ownerId],
    );
    await pool.query(
      `INSERT INTO business_audit_log
         (business_id, actor_user_id, action, target_type, target_id, before_state, after_state)
       VALUES ($1, $2, 'business.member.updated', 'member', $3,
               $4::jsonb, $5::jsonb)`,
      [businessId, ownerId, staffId,
       JSON.stringify({ note: 'Phase Staff was on the rota' }),
       JSON.stringify({ note: 'Phase Staff asked for Friday off', member: { first_name: 'Phase', last_name: 'Staff' } })],
    );
  });

  afterAll(async () => {
    await pool.query('DELETE FROM restaurant_scheduled_report_deliveries WHERE scheduled_report_id IN (SELECT id FROM restaurant_scheduled_reports WHERE restaurant_id = $1)', [restaurantId]).catch(() => {});
    await pool.query('DELETE FROM restaurant_scheduled_reports WHERE restaurant_id = $1', [restaurantId]).catch(() => {});
    await pool.query('DELETE FROM restaurant_daily_rollups WHERE restaurant_id = $1', [restaurantId]).catch(() => {});
    await pool.query('DELETE FROM restaurant_temperature_logs WHERE restaurant_id = $1', [restaurantId]).catch(() => {});
    await pool.query('DELETE FROM restaurant_break_attestations WHERE business_id = $1', [businessId]).catch(() => {});
    await pool.query('DELETE FROM restaurant_erasure_requests WHERE business_id = $1', [businessId]).catch(() => {});
    await pool.query('DELETE FROM staff_offboarding_records WHERE business_id = $1', [businessId]).catch(() => {});
    await pool.query('DELETE FROM business_staff_labor_profiles WHERE business_id = $1', [businessId]).catch(() => {});
    await pool.query('DELETE FROM restaurant_staff_documents WHERE restaurant_id = $1', [restaurantId]).catch(() => {});
    await pool.query('DELETE FROM restaurant_inventory_adjustments WHERE restaurant_id = $1', [restaurantId]).catch(() => {});
    await pool.query('DELETE FROM food_order_items WHERE order_id = $1', [orderId]).catch(() => {});
    await pool.query('DELETE FROM food_orders WHERE restaurant_id = $1', [restaurantId]).catch(() => {});
    await pool.query('DELETE FROM restaurant_inventory_item_mappings WHERE restaurant_id = $1', [restaurantId]).catch(() => {});
    await pool.query('DELETE FROM restaurant_inventory_items WHERE restaurant_id = $1', [restaurantId]).catch(() => {});
    await pool.query('DELETE FROM business_time_entries WHERE business_id = $1', [businessId]).catch(() => {});
    await pool.query('DELETE FROM restaurant_corrective_actions WHERE audit_id IN (SELECT id FROM restaurant_audits WHERE restaurant_id = $1)', [restaurantId]).catch(() => {});
    await pool.query('DELETE FROM restaurant_audit_findings WHERE audit_id IN (SELECT id FROM restaurant_audits WHERE restaurant_id = $1)', [restaurantId]).catch(() => {});
    await pool.query('DELETE FROM restaurant_audits WHERE restaurant_id = $1', [restaurantId]).catch(() => {});
    await pool.query('DELETE FROM restaurant_audit_templates WHERE restaurant_id = $1', [restaurantId]).catch(() => {});
    await pool.query('DELETE FROM restaurant_labor_jurisdictions WHERE restaurant_id = $1', [restaurantId]).catch(() => {});
    await pool.query('DELETE FROM restaurant_inventory_storage_areas WHERE restaurant_id = $1', [restaurantId]).catch(() => {});
    await pool.query('DELETE FROM business_members WHERE business_id = $1', [businessId]).catch(() => {});
    await pool.query('DELETE FROM restaurant_locations WHERE restaurant_id = $1', [restaurantId]).catch(() => {});
    await pool.query('DELETE FROM food_menu_items WHERE restaurant_id = $1', [restaurantId]).catch(() => {});
    await pool.query('DELETE FROM food_restaurants WHERE business_id = $1', [businessId]).catch(() => {});
    await pool.query('DELETE FROM businesses WHERE id = $1', [businessId]).catch(() => {});
    await pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [[ownerId, staffId]]).catch(() => {});
    await pool.end().catch(() => {});
  });

  test('migration created the Phase 7 tables and widened the doc-type check', async () => {
    const { rows } = await pool.query(
      `SELECT table_name FROM information_schema.tables
        WHERE table_name IN ('restaurant_temperature_logs', 'restaurant_break_attestations',
          'restaurant_scheduled_reports', 'restaurant_scheduled_report_deliveries',
          'restaurant_daily_rollups', 'restaurant_retention_policies', 'restaurant_erasure_requests')`,
    );
    expect(rows.map((r) => r.table_name).sort()).toEqual([
      'restaurant_break_attestations',
      'restaurant_daily_rollups',
      'restaurant_erasure_requests',
      'restaurant_retention_policies',
      'restaurant_scheduled_report_deliveries',
      'restaurant_scheduled_reports',
      'restaurant_temperature_logs',
    ]);
    const { rows: [check] } = await pool.query(
      `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
        WHERE conrelid = 'restaurant_staff_documents'::regclass AND contype = 'c'
          AND pg_get_constraintdef(oid) LIKE '%certificate_food_handler%'`,
    );
    expect(check.def).toContain('work_permit');
  });

  test('temperature breach flags from the area config, falls back to the range label', async () => {
    const breach = await temperatureService.recordTemperatureLog(pool, {
      restaurantId, locationId, areaId, readingCelsius: 9, recordedBy: ownerId, businessDate: '2026-11-06',
    });
    expect(breach.breach).toBe(true);
    expect(breach.log.threshold_min_c).toBe(2);
    expect(breach.log.threshold_max_c).toBe(4);
    const ok = await temperatureService.recordTemperatureLog(pool, {
      restaurantId, locationId, areaId, readingCelsius: 3, recordedBy: ownerId, businessDate: '2026-11-06',
    });
    expect(ok.breach).toBe(false);
    const label = await temperatureService.recordTemperatureLog(pool, {
      restaurantId, locationId, areaId: labelAreaId, readingCelsius: 9, recordedBy: ownerId, businessDate: '2026-11-06',
    });
    expect(label.breach).toBe(true);
    expect(label.log.threshold_min_c).toBe(2);
    const summary = await temperatureService.dailyTemperatureSummary(pool, {
      restaurantId, businessDate: '2026-11-06',
    });
    expect(summary.readings).toBe(3);
    expect(summary.breaches).toBe(2);
    const linked = await temperatureService.linkCorrectiveAction(pool, {
      restaurantId, logId: breach.log.id, correctiveActionId: actionId,
    });
    expect(Number(linked.corrective_action_id)).toBe(actionId);
    await expect(temperatureService.linkCorrectiveAction(pool, {
      restaurantId, logId: breach.log.id, correctiveActionId: foreignActionId,
    })).rejects.toMatchObject({ status: 404 });
  });

  test('break attestation disputes a taken claim and confirms a waiver, premium owed either way', async () => {
    const taken = await breakAttestation.recordBreakAttestation(pool, {
      businessId, userId: staffId, timeEntryId: entryId, mealBreakTaken: true,
    });
    expect(taken.missedMealBreak).toBe(true);
    expect(taken.mealBreakPremiumHours).toBe(1);
    expect(taken.disputed).toBe(true);
    const waived = await breakAttestation.recordBreakAttestation(pool, {
      businessId, userId: staffId, timeEntryId: waivedEntryId,
      mealBreakTaken: false, waived: true, waiverReason: 'Lunch rush',
    });
    expect(waived.missedMealBreak).toBe(true);
    expect(waived.mealBreakPremiumHours).toBe(1);
    expect(waived.disputed).toBe(false);
    const byUser = await breakAttestation.attestationSummaryByUser(pool, {
      businessId, fromDate: '2026-11-06', toDate: '2026-11-06',
    });
    const summary = byUser.get(staffId);
    expect(summary.waived_breaks).toBe(1);
    expect(summary.disputed_attestations).toBe(1);
  });

  test('a second attestation appends a version; readers see the latest statement only (item 43)', async () => {
    // entryId already carries a disputed "taken" attestation from the
    // previous test. Correcting it must keep the first statement.
    const corrected = await breakAttestation.recordBreakAttestation(pool, {
      businessId, userId: staffId, timeEntryId: entryId, mealBreakTaken: false,
    });
    expect(corrected.disputed).toBe(false);
    const { rows: versions } = await pool.query(
      'SELECT id, meal_break_taken FROM restaurant_break_attestations WHERE time_entry_id = $1 ORDER BY id',
      [entryId]
    );
    expect(versions).toHaveLength(2);
    expect(versions[0].meal_break_taken).toBe(true);
    expect(versions[1].meal_break_taken).toBe(false);
    const latest = await breakAttestation.latestAttestation(pool, { businessId, timeEntryId: entryId });
    expect(latest.id).toBe(versions[1].id);
    expect(latest.meal_break_taken).toBe(false);
    const byUser = await breakAttestation.attestationSummaryByUser(pool, {
      businessId, fromDate: '2026-11-06', toDate: '2026-11-06',
    });
    const summary = byUser.get(staffId);
    expect(summary.attestations).toBe(2);
    expect(summary.waived_breaks).toBe(1);
    expect(summary.missed_breaks).toBe(1);
    expect(summary.disputed_attestations).toBe(0);
    const listed = await breakAttestation.listAttestations(pool, {
      businessId, fromDate: '2026-11-06', toDate: '2026-11-06',
    });
    expect(listed).toHaveLength(2);
    expect(listed.find((a) => Number(a.time_entry_id) === entryId).meal_break_taken).toBe(false);
  });

  test('prime cost matches the hand-checked fixture', async () => {
    const prime = await primeCost.computePrimeCost({
      restaurant: { id: restaurantId, business_id: businessId, timezone: 'UTC', currency_code: 'USD' },
      fromDate: '2026-11-05', toDate: '2026-11-05',
      // Single-store scope so the store's own CA jurisdiction row (meal
      // premium) prices the shift; the unscoped view falls back to the
      // US-FED preset, which has no meal premium (Phase 1 behavior).
      locationIds: [locationId],
    });
    // Labor: 8h x 1000c = 8000c wages + 1h meal premium (CA, 6h+ shift,
    // no break recorded) x 1000c = 1000c. Food actual: 25 kg x 15.00 =
    // 37500c on 50000c revenue. Prime = 9000 + 37500 = 46500c = 93%.
    expect(prime.currency).toBe('USD');
    expect(prime.revenue_cents).toBe(50000);
    expect(prime.labor.labor_cost_cents).toBe(9000);
    expect(prime.labor.meal_break_premium_cents).toBe(1000);
    expect(prime.food.theoretical_cost_cents).toBe(30000);
    expect(prime.food.theoretical_cost_pct).toBe(60);
    expect(prime.food.actual_cost_cents).toBe(37500);
    expect(prime.food.actual_cost_pct).toBe(75);
    expect(prime.prime_cost_cents).toBe(46500);
    expect(prime.prime_cost_pct).toBe(93);
    expect(prime.servers.servers).toHaveLength(1);
    expect(prime.servers.servers[0].user_id).toBe(staffId);
    expect(prime.servers.servers[0].net_sales_cents).toBe(50000);
    expect(prime.servers.servers[0].tips_cents).toBe(500);
    expect(prime.dayparts.dayparts.find((d) => d.key === 'lunch').orders).toBe(1);
    expect(prime.dayparts.hourly[12].orders).toBe(1);
  });

  test('scheduled delivery sends once and replays the second run', async () => {
    const { rows: [{ id: scheduleId }] } = await pool.query(
      `INSERT INTO restaurant_scheduled_reports
         (restaurant_id, report_type, frequency, delivery_channel, recipients, created_by)
       VALUES ($1, 'labor', 'daily', 'in_app', $2::jsonb, $3) RETURNING id`,
      [restaurantId, JSON.stringify([{ user_id: staffId }]), ownerId],
    );
    const now = new Date('2026-11-06T10:00:00Z');
    const first = await scheduledReports.runDueScheduledReports(pool, { now });
    expect(first.sent).toBe(1);
    expect(sendNotification).toHaveBeenCalledTimes(1);
    expect(sendNotification.mock.calls[0][0].data.snapshot).toBe(true);
    expect(sendNotification.mock.calls[0][0].data.locked_close).toBe(false);
    // Reset the run marker so the job is due again: the ledger (not the
    // marker) must stop the duplicate send.
    await pool.query('UPDATE restaurant_scheduled_reports SET last_business_date = NULL WHERE id = $1', [scheduleId]);
    const second = await scheduledReports.runDueScheduledReports(pool, { now });
    expect(second.due).toBe(1);
    expect(second.skipped).toBe(1);
    expect(second.sent).toBe(0);
    expect(sendNotification).toHaveBeenCalledTimes(1);
    const { rows: deliveries } = await pool.query(
      'SELECT * FROM restaurant_scheduled_report_deliveries WHERE scheduled_report_id = $1',
      [scheduleId],
    );
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0].snapshot).toBe(true);
    expect(deliveries[0].locked_close).toBe(false);
  });

  test('rollup cache serves the second read and recomputes after expiry', async () => {
    let calls = 0;
    const compute = async () => { calls += 1; return { totals: { currency: 'USD', labor_cost_cents: 9000 }, stores: [] }; };
    const first = await getCachedRollup(pool, {
      restaurantId, locationId: null, fromDate: '2026-11-05', toDate: '2026-11-05', kind: 'hq_labor', compute,
    });
    expect(first.is_cached).toBe(false);
    expect(calls).toBe(1);
    const second = await getCachedRollup(pool, {
      restaurantId, locationId: null, fromDate: '2026-11-05', toDate: '2026-11-05', kind: 'hq_labor', compute,
    });
    expect(second.is_cached).toBe(true);
    expect(second.payload.totals.labor_cost_cents).toBe(9000);
    expect(calls).toBe(1);
    await pool.query(
      `UPDATE restaurant_daily_rollups SET expires_at = NOW() - INTERVAL '1 minute'
        WHERE restaurant_id = $1 AND kind = 'hq_labor'`,
      [restaurantId],
    );
    const third = await getCachedRollup(pool, {
      restaurantId, locationId: null, fromDate: '2026-11-05', toDate: '2026-11-05', kind: 'hq_labor', compute,
    });
    expect(third.is_cached).toBe(false);
    expect(calls).toBe(2);
  });

  test('anonymization refuses when no retention deadline exists', async () => {
    const outcome = await retention.anonymizeFormerStaff(pool, {
      businessId, restaurantId, userId: staffId,
    });
    expect(outcome.skipped).toBe(true);
    expect(outcome.reason).toBe('retention_not_established');
    // Nothing was touched: the document, the note, the minor profile,
    // the pay-run label and the audit row are all still there for the
    // erasure test that follows.
    const { rows: [doc] } = await pool.query(
      'SELECT deleted_at FROM restaurant_staff_documents WHERE restaurant_id = $1 AND user_id = $2',
      [restaurantId, staffId],
    );
    expect(doc.deleted_at).toBeNull();
    const { rows: entries } = await pool.query(
      'SELECT description FROM business_time_entries WHERE id = $1',
      [entryId],
    );
    expect(entries[0].description).toBe('Covered for a coworker');
  });

  test('retention policy resolves and anonymization clears personal data but keeps history', async () => {
    const stored = await retention.setRetentionPolicy(pool, {
      restaurantId, recordClass: 'time_entries', retentionYears: 10, source: 'operator', updatedBy: ownerId,
    });
    expect(Number(stored.retention_years)).toBe(10);
    const policy = await retention.getRetentionPolicy(pool, { restaurantId, recordClass: 'time_entries' });
    expect(policy.retention_years).toBe(10);
    expect(policy.source).toBe('operator');
    const outcome = await retention.anonymizeFormerStaff(pool, {
      businessId, restaurantId, userId: staffId, retainUntil: '2020-01-01',
    });
    expect(outcome.skipped).toBe(false);
    expect(outcome.documents_deleted).toBe(1);
    expect(outcome.time_entry_notes_cleared).toBe(1);
    // Finding 60: the fixture minor band runs to 2027-01-01, still
    // current, so the labor profile stays.
    expect(outcome.labor_profile_removed).toBe(0);
    // Finding 13: the name comes off the retained rows; amounts stay.
    expect(outcome.pay_run_labels_cleared).toBe(1);
    expect(outcome.time_entry_edits_scrubbed).toBe(1);
    expect(outcome.audit_names_scrubbed).toBe(1);
    expect(outcome.history_rows_retained).toBe(3);
    const { rows: [doc] } = await pool.query(
      'SELECT deleted_at FROM restaurant_staff_documents WHERE restaurant_id = $1 AND user_id = $2',
      [restaurantId, staffId],
    );
    expect(doc.deleted_at).not.toBeNull();
    const { rows: entries } = await pool.query(
      'SELECT id, hours_worked, description FROM business_time_entries WHERE business_id = $1 AND user_id = $2 ORDER BY id',
      [businessId, staffId],
    );
    expect(entries).toHaveLength(3);
    expect(entries.every((e) => e.description == null)).toBe(true);
    expect(Number(entries[0].hours_worked)).toBe(8);
    const { rows: profiles } = await pool.query(
      'SELECT minor_until::text AS minor_until FROM business_staff_labor_profiles WHERE business_id = $1 AND user_id = $2',
      [businessId, staffId],
    );
    expect(profiles).toHaveLength(1);
    expect(profiles[0].minor_until).toBe('2027-01-01');
    const { rows: [line] } = await pool.query(
      'SELECT staff_label, total_pay_cents FROM restaurant_pay_run_lines WHERE pay_run_id = $1',
      [payRunId],
    );
    expect(line.staff_label).toBe('Former staff');
    expect(Number(line.total_pay_cents)).toBe(8000);
    const { rows: [edit] } = await pool.query(
      'SELECT reason FROM business_time_entry_edits WHERE entry_id = $1',
      [entryId],
    );
    expect(edit.reason).toBe('Fixed clock-in for Former staff');
    const { rows: [audit] } = await pool.query(
      `SELECT before_state, after_state FROM business_audit_log
        WHERE business_id = $1 AND action = 'business.member.updated'`,
      [businessId],
    );
    expect(JSON.stringify(audit.before_state)).not.toContain('Phase Staff');
    expect(JSON.stringify(audit.after_state)).not.toContain('Phase');
    expect(audit.after_state.note).toBe('Former staff asked for Friday off');
    expect(audit.after_state.member.first_name).toBe('Former staff');
    expect(audit.after_state.member.last_name).toBe('Former staff');
  });

  test('a jurisdiction retention row only wins for its own jurisdiction_code', async () => {
    // 'pay_runs' class: a restaurant-wide jurisdiction row (US-CA,
    // 10y) against a location-scoped operator row (5y). The unique
    // constraint allows one row per (restaurant, location, class), so
    // the two rows compete across locations.
    await retention.setRetentionPolicy(pool, {
      restaurantId, recordClass: 'pay_runs', retentionYears: 10,
      jurisdictionCode: 'US-CA', source: 'jurisdiction', updatedBy: ownerId,
    });
    await retention.setRetentionPolicy(pool, {
      restaurantId, locationId, recordClass: 'pay_runs', retentionYears: 5,
      source: 'operator', updatedBy: ownerId,
    });
    const matching = await retention.getRetentionPolicy(pool, {
      restaurantId, locationId, recordClass: 'pay_runs', jurisdictionCode: 'US-CA',
    });
    expect(matching.retention_years).toBe(10);
    expect(matching.source).toBe('jurisdiction');
    const other = await retention.getRetentionPolicy(pool, {
      restaurantId, locationId, recordClass: 'pay_runs', jurisdictionCode: 'US-NY',
    });
    expect(other.retention_years).toBe(5);
    expect(other.source).toBe('operator');
    const none = await retention.getRetentionPolicy(pool, {
      restaurantId, locationId, recordClass: 'pay_runs',
    });
    expect(none.retention_years).toBe(5);
    expect(none.source).toBe('operator');
    await pool.query(
      'DELETE FROM restaurant_retention_policies WHERE restaurant_id = $1 AND record_class = $2',
      [restaurantId, 'pay_runs'],
    );
  });

  test('an expired minor band is deleted while a current one is kept', async () => {
    const formerMinorId = crypto.randomUUID();
    await pool.query(
      'INSERT INTO users (id, email, password_hash, first_name, last_name) VALUES ($1, $2, $3, $4, $5)',
      [formerMinorId, `phase7-former-minor-${suffix}@example.com`, 'test-hash', 'Former', 'Minor'],
    );
    await pool.query(
      `INSERT INTO business_staff_labor_profiles (business_id, user_id, minor_band, minor_until)
       VALUES ($1, $2, 'age_16_17', '2020-01-01')`,
      [businessId, formerMinorId],
    );
    const outcome = await retention.anonymizeFormerStaff(pool, {
      businessId, restaurantId, userId: formerMinorId, retainUntil: '2020-01-01',
    });
    expect(outcome.skipped).toBe(false);
    expect(outcome.labor_profile_removed).toBe(1);
    const { rows: profiles } = await pool.query(
      'SELECT 1 FROM business_staff_labor_profiles WHERE business_id = $1 AND user_id = $2',
      [businessId, formerMinorId],
    );
    expect(profiles).toHaveLength(0);
    // A re-run for the fixture staff member still keeps the current
    // band (and the Finding 13 scrubs are idempotent second time round).
    const reRun = await retention.anonymizeFormerStaff(pool, {
      businessId, restaurantId, userId: staffId, retainUntil: '2020-01-01',
    });
    expect(reRun.labor_profile_removed).toBe(0);
    expect(reRun.pay_run_labels_cleared).toBe(0);
    expect(reRun.time_entry_edits_scrubbed).toBe(0);
    expect(reRun.audit_names_scrubbed).toBe(0);
    // The temp user cannot be deleted: this database carries
    // no-delete/no-update rules on food_customer_wallet_operator_audit_events
    // that rewrite the ON DELETE SET NULL check, so every DELETE FROM
    // users fails with "referential integrity query ... gave
    // unexpected result" (pre-existing quirk; the suite's own
    // afterAll swallows the same failure). The row is inert in the
    // disposable database, keyed by a unique test email.
    await pool.query('DELETE FROM users WHERE id = $1', [formerMinorId]).catch(() => {});
  });

  test('retention sweep completes an approved erasure past its deadline', async () => {
    const { rows: [{ id: requestId }] } = await pool.query(
      `INSERT INTO restaurant_erasure_requests
         (business_id, restaurant_id, user_id, requested_by, status, reason)
       VALUES ($1, $2, $3, $4, 'approved', 'Former staff asked to be forgotten') RETURNING id`,
      [businessId, restaurantId, staffId, ownerId],
    );
    const result = await sweep(pool);
    expect(result.completedRequests).toBe(1);
    const { rows: [request] } = await pool.query(
      'SELECT status, outcome FROM restaurant_erasure_requests WHERE id = $1',
      [requestId],
    );
    expect(request.status).toBe('completed');
    expect(request.outcome.history_rows_retained).toBe(3);
  });
});
