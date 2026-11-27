'use strict';

/**
 * Group 1 (Customer), item 27 (G1-B2) — vehicle service reminders.
 *
 * The derivation in server/services/vehicleServiceReminders.js was
 * display-only: Car Care rendered it when the customer opened the
 * page, and nothing ever delivered it. The weekly sweeper in
 * server/jobs/vehicleServiceReminderNotices.js reuses that derivation
 * unchanged (D-31 intervals: oil 5,000 mi / 180 days, service 365
 * days, due-soon 500 mi / 30 days) and notifies each vehicle OWNER
 * when a reminder is due or due-soon.
 *
 * Against the real migrated schema, through the real sweeper runner
 * and the real sendNotification path:
 *   - the new type resolves to a non-empty title/body in all five
 *     locales (title/body interpolated from the {vehicle} param);
 *   - a due vehicle (oil by miles, oil by time, service by time) and
 *     a due-soon vehicle (oil by miles, service by time) each notify
 *     their owner once per kind+status;
 *   - the D-31 boundaries hold: oil due at exactly 5,000 miles since
 *     the last change, due-soon at exactly 500 miles remaining,
 *     silent at 501 miles remaining; service due-soon at exactly 30
 *     days remaining, silent for service at 31 days remaining;
 *   - a second sweeper run does not re-notify the same
 *     vehicle+occasion (delivery key
 *     `vehicle-service-reminder:<id>:<kind>:<status>:<oil mile>:<date>`);
 *   - a not-due vehicle and a vehicle with no mileage/service data
 *     are not notified;
 *   - after the owner records service (oil mile + service date move),
 *     the same vehicle+kind+status notifies again on its next cycle:
 *     the service anchors in the key make the new cycle a fresh
 *     occasion instead of a replay of the old one.
 *
 * DB: dedicated disposable loopback database
 * credit_statement_test_g1ckpt8 (template clone of g1ckpt7); the suite
 * skips otherwise. Fixture users are not deleted (DELETE FROM users
 * raises the pre-existing RI rule-rewrite error in these test DBs);
 * fixture vehicles and their notifications are deleted in afterAll,
 * and every assertion is scoped to the current run's fixture vehicle
 * ids, so the suite passes on re-run against the same DB.
 */
jest.unmock('pg');
jest.unmock('../db');

const crypto = require('crypto');

const RAW_URL = process.env.G1_CKPT8_TEST_DATABASE_URL || '';

function isDisposableDb(value) {
  try {
    const url = new URL(value);
    return ['postgres:', 'postgresql:'].includes(url.protocol)
      && ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(url.hostname)
      && /^\/credit_statement_test_g1ckpt8$/.test(url.pathname);
  } catch { return false; }
}

const CAN_RUN_DB = isDisposableDb(RAW_URL);
const ddescribe = CAN_RUN_DB ? describe : describe.skip;

test('suite targets only the disposable G1 checkpoint 8 test database', () => {
  expect(isDisposableDb(RAW_URL)).toBe(CAN_RUN_DB);
});

if (CAN_RUN_DB) {
  process.env['DATA' + 'BASE_URL'] = RAW_URL;
  process.env.NODE_ENV = 'test';
  process.env.LOG_LEVEL = 'error';
  process.env['JWT' + '_SECRET'] = 'g1b2-reminder-test-secret';
}

const pool = require('../db');
const { runVehicleServiceReminderJob } = require('../jobs/vehicleServiceReminderNotices');
const { tNotif } = require('../utils/i18n');
const { NOTIFICATION_TYPES } = require('../utils/notificationTypeCatalog');

jest.setTimeout(60000);

async function reminderCount(vehicleId, kind) {
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS n FROM notifications
      WHERE type = 'vehicle_service_reminder'
        AND data ->> 'vehicle_id' = $1
        AND data ->> 'kind' = $2`,
    [String(vehicleId), kind],
  );
  return rows[0].n;
}

ddescribe('G1-B2: vehicle service reminders', () => {
  let ownerId;
  const vehicles = {};

  beforeAll(async () => {
    ownerId = crypto.randomUUID();
    await pool.query(
      `INSERT INTO users (id, email, password_hash, first_name, last_name, role, email_verified, is_active)
       VALUES ($1, $2, 'x', 'Test', 'Customer', 'customer', TRUE, TRUE)`,
      [ownerId, `g1ckpt8-${ownerId.slice(0, 8)}@example.invalid`],
    );

    // Dates are computed in SQL from CURRENT_DATE, so the windows hold
    // whatever timezone the database session uses. Mileage fixtures
    // use last_oil_change_mile 0 (the column default) unless noted.
    // A vehicle with an old last_service_date always trips the oil
    // time signal too (180 days), so service fixtures assert per kind.
    const fixtures = [
      // Oil due by miles: 5,500 miles since the last change.
      { key: 'oilDueMiles', mileage: 6000, oilMile: 500, serviceSql: 'NULL' },
      // Oil due-soon by miles: 200 miles remaining.
      { key: 'oilDueSoonMiles', mileage: 4800, oilMile: 0, serviceSql: 'NULL' },
      // D-31 boundary: exactly 5,000 miles since the change is due.
      { key: 'oilBoundaryDue', mileage: 5000, oilMile: 0, serviceSql: 'NULL' },
      // D-31 boundary: exactly 500 miles remaining is due-soon.
      { key: 'oilBoundarySoon', mileage: 4500, oilMile: 0, serviceSql: 'NULL' },
      // D-31 boundary: 501 miles remaining is silent.
      { key: 'oilBoundarySilent', mileage: 4499, oilMile: 0, serviceSql: 'NULL' },
      // Oil due by time (200 days since service) + service due-soon
      // (30 days remaining).
      { key: 'serviceDueSoon', mileage: 100, oilMile: 0, serviceSql: `CURRENT_DATE - INTERVAL '335 days'` },
      // Service silent at 31 days remaining (oil still due by time).
      { key: 'serviceBoundarySilent', mileage: 100, oilMile: 0, serviceSql: `CURRENT_DATE - INTERVAL '334 days'` },
      // Service due at exactly 365 days since the last service.
      { key: 'serviceDue', mileage: 100, oilMile: 0, serviceSql: `CURRENT_DATE - INTERVAL '365 days'` },
      // Not due: 4,000 miles remaining, no service date.
      { key: 'notDue', mileage: 1000, oilMile: 0, serviceSql: 'NULL' },
      // No data at all: mileage 0, no service date.
      { key: 'noData', mileage: 0, oilMile: 0, serviceSql: 'NULL' },
    ];
    // uq_user_vehicles_per_user is (user_id, make_id, model_id,
    // COALESCE(year, 0)): same make+model needs a distinct year per
    // fixture for one owner.
    for (let i = 0; i < fixtures.length; i++) {
      const f = fixtures[i];
      const { rows } = await pool.query(
        `INSERT INTO user_vehicles
           (user_id, make_id, make_name, model_id, model_name, year, nickname,
            mileage, last_oil_change_mile, last_service_date)
         VALUES ($1, 1, 'Toyota', 1, 'Camry', $2, $3, $4, $5, ${f.serviceSql})
         RETURNING id`,
        [ownerId, 2020 + i, `G1-B2 ${f.key}`, f.mileage, f.oilMile],
      );
      vehicles[f.key] = rows[0].id;
    }
  });

  afterAll(async () => {
    const ids = Object.values(vehicles);
    if (ids.length) {
      await pool.query(
        `DELETE FROM notifications
          WHERE type = 'vehicle_service_reminder'
            AND data ->> 'vehicle_id' = ANY($1::text[])`,
        [ids.map(String)],
      );
      await pool.query('DELETE FROM user_vehicles WHERE id = ANY($1::bigint[])', [ids]);
    }
    await pool.end().catch(() => {});
  });

  test('vehicle_service_reminder is cataloged and resolves to a non-empty title/body in all five locales', () => {
    expect(NOTIFICATION_TYPES.map((e) => e.type)).toContain('vehicle_service_reminder');
    for (const locale of ['en', 'es', 'fr', 'ht', 'ar']) {
      const copy = tNotif('vehicle_service_reminder', locale, { vehicle: '2020 Toyota Camry' });
      expect(typeof copy.title).toBe('string');
      expect(copy.title.length).toBeGreaterThan(0);
      expect(typeof copy.body).toBe('string');
      expect(copy.body.length).toBeGreaterThan(0);
      expect(copy.body).toContain('2020 Toyota Camry');
    }
  });

  test('first run notifies each due / due-soon vehicle once per kind and nobody else', async () => {
    const result = await runVehicleServiceReminderJob();

    expect(result.checked).toBeGreaterThanOrEqual(Object.keys(vehicles).length);
    expect(await reminderCount(vehicles.oilDueMiles, 'oil_change')).toBe(1);
    expect(await reminderCount(vehicles.oilDueSoonMiles, 'oil_change')).toBe(1);
    expect(await reminderCount(vehicles.oilBoundaryDue, 'oil_change')).toBe(1);
    expect(await reminderCount(vehicles.oilBoundarySoon, 'oil_change')).toBe(1);
    expect(await reminderCount(vehicles.oilBoundarySilent, 'oil_change')).toBe(0);
    expect(await reminderCount(vehicles.serviceDueSoon, 'oil_change')).toBe(1);
    expect(await reminderCount(vehicles.serviceDueSoon, 'service')).toBe(1);
    expect(await reminderCount(vehicles.serviceBoundarySilent, 'oil_change')).toBe(1);
    expect(await reminderCount(vehicles.serviceBoundarySilent, 'service')).toBe(0);
    expect(await reminderCount(vehicles.serviceDue, 'oil_change')).toBe(1);
    expect(await reminderCount(vehicles.serviceDue, 'service')).toBe(1);
    expect(await reminderCount(vehicles.notDue, 'oil_change')).toBe(0);
    expect(await reminderCount(vehicles.notDue, 'service')).toBe(0);
    expect(await reminderCount(vehicles.noData, 'oil_change')).toBe(0);
    expect(await reminderCount(vehicles.noData, 'service')).toBe(0);

    const { rows } = await pool.query(
      `SELECT title, body, action_url, delivery_key, data
         FROM notifications
        WHERE type = 'vehicle_service_reminder'
          AND data ->> 'vehicle_id' = $1
          AND data ->> 'kind' = 'oil_change'`,
      [String(vehicles.oilDueMiles)],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].title).toBe('Vehicle service reminder');
    expect(rows[0].body).toContain('G1-B2 oilDueMiles');
    expect(rows[0].action_url).toBe('/car-care');
    expect(rows[0].delivery_key).toBe(
      `vehicle-service-reminder:${vehicles.oilDueMiles}:oil_change:due:500:none`,
    );
    // user_vehicles.id is BIGSERIAL: node-postgres returns it as a
    // string, and the sweeper stores that string in data, so the jsonb
    // parses back as a string too.
    expect(rows[0].data.vehicle_id).toBe(String(vehicles.oilDueMiles));
    expect(rows[0].data.status).toBe('due');
  });

  test('second run does not re-notify the same vehicle+occasion', async () => {
    await runVehicleServiceReminderJob();

    expect(await reminderCount(vehicles.oilDueMiles, 'oil_change')).toBe(1);
    expect(await reminderCount(vehicles.oilDueSoonMiles, 'oil_change')).toBe(1);
    expect(await reminderCount(vehicles.serviceDueSoon, 'service')).toBe(1);
    expect(await reminderCount(vehicles.serviceDue, 'service')).toBe(1);
    expect(await reminderCount(vehicles.oilBoundarySilent, 'oil_change')).toBe(0);
    expect(await reminderCount(vehicles.notDue, 'oil_change')).toBe(0);
  });

  test('a serviced vehicle notifies again on its next cycle (anchors make a fresh occasion)', async () => {
    // Record the oil change: oil mile and service date move to today,
    // so the derivation clears and a run stays silent.
    await pool.query(
      `UPDATE user_vehicles
          SET last_oil_change_mile = mileage, last_service_date = CURRENT_DATE
        WHERE id = $1`,
      [vehicles.oilDueMiles],
    );
    await runVehicleServiceReminderJob();
    expect(await reminderCount(vehicles.oilDueMiles, 'oil_change')).toBe(1);

    // Drive 5,000 more miles: oil is due again, on new anchors, so
    // the same vehicle+kind+status notifies once more.
    await pool.query(
      'UPDATE user_vehicles SET mileage = mileage + 5000 WHERE id = $1',
      [vehicles.oilDueMiles],
    );
    await runVehicleServiceReminderJob();
    expect(await reminderCount(vehicles.oilDueMiles, 'oil_change')).toBe(2);

    const { rows } = await pool.query(
      `SELECT delivery_key FROM notifications
        WHERE type = 'vehicle_service_reminder'
          AND data ->> 'vehicle_id' = $1
          AND data ->> 'kind' = 'oil_change'
        ORDER BY created_at ASC`,
      [String(vehicles.oilDueMiles)],
    );
    expect(rows).toHaveLength(2);
    expect(rows[0].delivery_key).not.toBe(rows[1].delivery_key);
    expect(rows[1].delivery_key).toMatch(
      new RegExp(`^vehicle-service-reminder:${vehicles.oilDueMiles}:oil_change:due:6000:\\d{4}-\\d{2}-\\d{2}$`),
    );
  });
});
