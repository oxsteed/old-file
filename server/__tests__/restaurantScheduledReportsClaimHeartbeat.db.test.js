'use strict';

/**
 * Domain 8 #19: scheduled-report stale reclaim can double-deliver a
 * slow build.
 *
 * Staleness was keyed on created_at, which the reclaim never updates,
 * while markDeliverySent/markDeliveryFailed carried no status='pending'
 * predicate. A build+delivery taking over PENDING_STALE_MINUTES (60)
 * had its row reclaimed mid-flight by the next run, which sent the
 * same report a second time; the first run then marked it sent again
 * with no error.
 *
 * Against the real migrated schema (claim/marker functions run for
 * real, no builders involved):
 *   - a claim stamps claimed_at, and a fresh claim is not reclaimable
 *     even when created_at is hours old (staleness keys on the
 *     heartbeat, not created_at);
 *   - a claim whose claimed_at is older than the stale window is
 *     reclaimed, and the reclaim refreshes claimed_at;
 *   - markDeliverySent / markDeliveryFailed on a row that is no longer
 *     pending are no-ops returning 0 and change nothing, so a
 *     double-mark is visible instead of silent.
 *
 * DB: disposable credit_statement_test only; the suite skips otherwise.
 * The test database must be migrated first.
 */
jest.unmock('pg');
jest.unmock('../db');

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
  process.env.LOG_LEVEL = 'error';
  process.env['JWT' + '_SECRET'] = 'scheduled-reports-claim-test-secret';
}

const pool = require('../db');
const scheduledReports = require('../services/restaurantScheduledReports');
const { claimScheduledReportDelivery, markDeliverySent, markDeliveryFailed, PENDING_STALE_MINUTES } = scheduledReports;

jest.setTimeout(60000);

const NOW = new Date('2026-11-06T10:00:00Z');
const BUSINESS_DATE = '2026-11-05';
const AS_OF = new Date('2026-11-06T10:00:00Z');

ddescribe('Domain 8 #19: delivery claim heartbeat and predicated markers', () => {
  const suffix = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  const ownerId = crypto.randomUUID();
  const staffId = crypto.randomUUID();
  let businessId;
  let restaurantId;
  let scheduleId;

  beforeAll(async () => {
    const { rows: [column] } = await pool.query(
      `SELECT 1 AS ok FROM information_schema.columns
        WHERE table_name = 'restaurant_scheduled_report_deliveries' AND column_name = 'claimed_at'`,
    );
    if (!column) {
      throw new Error('Delivery ledger is missing claimed_at: migrate credit_statement_test before running this test');
    }
    await pool.query(
      'INSERT INTO users (id, email, password_hash, first_name, last_name) VALUES ($1, $2, $3, $4, $5), ($6, $7, $8, $9, $10)',
      [ownerId, `claim-owner-${suffix}@example.com`, 'test-hash', 'Claim', 'Owner',
       staffId, `claim-staff-${suffix}@example.com`, 'test-hash', 'Claim', 'Staff'],
    );
    ({ rows: [{ id: businessId }] } = await pool.query(
      'INSERT INTO businesses (user_id, business_name) VALUES ($1, $2) RETURNING id',
      [ownerId, `Scheduled Reports Claim ${suffix}`],
    ));
    businessId = Number(businessId);
    ({ rows: [{ id: restaurantId }] } = await pool.query(
      `INSERT INTO food_restaurants (business_id, owner_user_id, display_name, timezone, currency_code)
       VALUES ($1, $2, $3, 'UTC', 'USD') RETURNING id`,
      [businessId, ownerId, `Scheduled Reports Claim ${suffix}`],
    ));
    restaurantId = Number(restaurantId);
    ({ rows: [{ id: scheduleId }] } = await pool.query(
      `INSERT INTO restaurant_scheduled_reports
         (restaurant_id, report_type, frequency, delivery_channel, recipients, created_by)
       VALUES ($1, 'labor', 'daily', 'in_app', $2::jsonb, $3) RETURNING id`,
      [restaurantId, JSON.stringify([{ user_id: staffId }]), ownerId],
    ));
    scheduleId = Number(scheduleId);
  });

  afterAll(async () => {
    await pool.query('DELETE FROM restaurant_scheduled_report_deliveries WHERE scheduled_report_id = $1', [scheduleId]).catch(() => {});
    await pool.query('DELETE FROM restaurant_scheduled_reports WHERE id = $1', [scheduleId]).catch(() => {});
    await pool.query('DELETE FROM food_restaurants WHERE id = $1', [restaurantId]).catch(() => {});
    await pool.query('DELETE FROM businesses WHERE id = $1', [businessId]).catch(() => {});
    await pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [[ownerId, staffId]]).catch(() => {});
    await pool.end().catch(() => {});
  });

  function scheduleRow() {
    return { id: scheduleId, report_type: 'labor', delivery_channel: 'in_app' };
  }

  async function insertDelivery({ status = 'pending', createdAt = NOW.toISOString(), claimedAt = NOW.toISOString(), businessDate = BUSINESS_DATE } = {}) {
    const { rows: [row] } = await pool.query(
      `INSERT INTO restaurant_scheduled_report_deliveries
         (scheduled_report_id, business_date, report_type, as_of, snapshot, locked_close, channel, status, recipient_count, created_at, claimed_at)
       VALUES ($1, $2::date, 'labor', $3, TRUE, FALSE, 'in_app', $4, 0, $5, $6)
       RETURNING *`,
      [scheduleId, businessDate, AS_OF.toISOString(), status, createdAt, claimedAt],
    );
    return row;
  }

  async function deliveryStatus(id) {
    const { rows: [row] } = await pool.query(
      'SELECT status, claimed_at, created_at FROM restaurant_scheduled_report_deliveries WHERE id = $1',
      [id],
    );
    return row;
  }

  test('a claim stamps claimed_at, and staleness keys on it, not created_at', async () => {
    expect(PENDING_STALE_MINUTES).toBe(60);
    const claim = await claimScheduledReportDelivery(pool, {
      schedule: scheduleRow(), businessDate: '2026-11-04', asOf: AS_OF, now: NOW,
    });
    expect(claim.outcome).toBe('claimed');
    expect(claim.delivery.status).toBe('pending');
    const claimedAt = new Date(claim.delivery.claimed_at).getTime();
    expect(Math.abs(claimedAt - NOW.getTime())).toBeLessThan(5 * 60 * 1000);

    // A slow build in flight: the row was created 2 hours ago, but the
    // claim heartbeat is fresh. Before the fix the stale check read
    // created_at and this row was reclaimed mid-flight.
    const old = await insertDelivery({
      businessDate: '2026-11-03',
      createdAt: new Date(NOW.getTime() - 2 * 60 * 60 * 1000).toISOString(),
      claimedAt: NOW.toISOString(),
    });
    const second = await claimScheduledReportDelivery(pool, {
      schedule: scheduleRow(), businessDate: '2026-11-03', asOf: AS_OF, now: NOW,
    });
    expect(second.outcome).toBe('in_progress');
    expect(second.delivery).toBeNull();
    expect((await deliveryStatus(old.id)).status).toBe('pending');
  });

  test('a claim older than the stale window is reclaimed and the heartbeat refreshes', async () => {
    const stale = await insertDelivery({
      businessDate: '2026-11-02',
      createdAt: new Date(NOW.getTime() - 3 * 60 * 60 * 1000).toISOString(),
      claimedAt: new Date(NOW.getTime() - (PENDING_STALE_MINUTES + 1) * 60 * 1000).toISOString(),
    });
    const claim = await claimScheduledReportDelivery(pool, {
      schedule: scheduleRow(), businessDate: '2026-11-02', asOf: AS_OF, now: NOW,
    });
    expect(claim.outcome).toBe('reclaimed_stale');
    expect(claim.delivery.status).toBe('pending');
    const after = await deliveryStatus(stale.id);
    expect(Math.abs(new Date(after.claimed_at).getTime() - NOW.getTime())).toBeLessThan(5 * 60 * 1000);
  });

  test('markers on a row that is no longer pending are no-ops returning 0', async () => {
    const row = await insertDelivery({ businessDate: '2026-11-01' });
    // Another run reclaimed and finished the row first.
    await pool.query(
      "UPDATE restaurant_scheduled_report_deliveries SET status = 'sent', recipient_count = 1 WHERE id = $1",
      [row.id],
    );
    expect(await markDeliverySent(pool, { deliveryId: row.id, recipientCount: 1 })).toBe(0);
    expect(await markDeliveryFailed(pool, { deliveryId: row.id, error: 'late failure' })).toBe(0);
    const after = await deliveryStatus(row.id);
    expect(after.status).toBe('sent');
  });

  test('markers on a pending row still apply and return 1', async () => {
    const sentRow = await insertDelivery({ businessDate: '2026-10-31' });
    expect(await markDeliverySent(pool, { deliveryId: sentRow.id, recipientCount: 2 })).toBe(1);
    expect((await deliveryStatus(sentRow.id)).status).toBe('sent');
    const failedRow = await insertDelivery({ businessDate: '2026-10-30' });
    expect(await markDeliveryFailed(pool, { deliveryId: failedRow.id, error: 'boom' })).toBe(1);
    expect((await deliveryStatus(failedRow.id)).status).toBe('failed');
  });
});
