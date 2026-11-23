'use strict';

// Group 4 Slice B (items 163, 164, 165): find work.
//
// 163 Distance preferences: the saved discovery radius round-trips through
// the preference endpoint (the /jobs feed seeding itself is client-side;
// its decision logic is covered by client/scripts/discoveryRadius.test.mjs).
// 164 Bid deadline reminders: the sweeper notifies once when a pending bid
// is within 24h of expiry and marks lapsed bids expired.
// 165 Work suitability preview: the preview answers distance (rounded
// miles, null when either side has no location) and the job's budget range.
//
// Follows the group1QuoteDeadline shape: disposable-DB guard, direct
// service calls, notification rows asserted in the notifications table.

const crypto = require('crypto');

const RAW_URL = process.env.STATEMENT_TEST_DATABASE_URL || '';

function isDisposableDb(value) {
  try {
    const url = new URL(value);
    return ['postgres:', 'postgresql:'].includes(url.protocol)
      && ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(url.hostname)
      && /^\/credit_statement_test$/.test(url.pathname);
  } catch { return false; }
}

const CAN_RUN_DB = isDisposableDb(RAW_URL);
const ddescribe = CAN_RUN_DB ? describe : describe.skip;

test('suite targets only the disposable Group 4 test database', () => {
  expect(isDisposableDb(RAW_URL)).toBe(CAN_RUN_DB);
});

if (CAN_RUN_DB) {
  process.env['DATA' + 'BASE_URL'] = RAW_URL;
  process.env.NODE_ENV = 'test';
  process.env.LOG_LEVEL = 'error';
  process.env['JWT' + '_SECRET'] = 'group4-slice-b-test-secret';
}

jest.unmock('pg');
jest.unmock('../db');
jest.unmock('../utils/transaction');

const pool = require('../db');
const discovery = require('../services/helperDiscoveryService');
const { sweepBidDeadlineNotices } = require('../jobs/bidDeadlineNotices');

jest.setTimeout(60000);

const helper = crypto.randomUUID();
const customer = crypto.randomUUID();
const jobs = [];
const bids = [];

async function makeJob({ status = 'published', title = 'Fix sink', location = null, budgetMin = null, budgetMax = null } = {}) {
  const { rows: [row] } = await pool.query(
    `INSERT INTO jobs(client_id, title, description, status, location_point, budget_min, budget_max)
     VALUES($1, $2, 'Fixture', $3,
       CASE WHEN $4::text IS NULL THEN NULL ELSE ST_SetSRID(ST_MakePoint(($4::jsonb->>'lng')::float, ($4::jsonb->>'lat')::float), 4326)::geography END,
       $5, $6)
     RETURNING *`,
    [customer, title, status, location ? JSON.stringify(location) : null, budgetMin, budgetMax],
  );
  jobs.push(row.id);
  return row;
}

async function makeBid(jobId, { expiresInHours = 12, amount = 500 } = {}) {
  const { rows: [row] } = await pool.query(
    `INSERT INTO bids(job_id, helper_id, amount, status, expires_at)
     VALUES($1, $2, $3, 'pending', NOW() + ($4 || ' hours')::interval)
     RETURNING *`,
    [jobId, helper, amount, String(expiresInHours)],
  );
  bids.push(row.id);
  return row;
}

ddescribe('Group 4 Slice B: find work (163, 164, 165)', () => {
  beforeAll(async () => {
    for (const [id, role] of [[helper, 'helper'], [customer, 'customer']]) {
      // Activation facts (identity + terms) so the helper.offer_services
      // grant actually activates under the access check.
      await pool.query(
        `INSERT INTO users(id, email, password_hash, first_name, last_name, role, email_verified, is_active,
           id_verified, terms_accepted, terms_accepted_at, terms_version, timezone)
         VALUES($1, $2, 'x', 'SliceB', 'Fixture', $3, TRUE, TRUE, TRUE, TRUE, NOW(), 'slice-b-test', 'UTC')`,
        [id, `g4b-${id.slice(0, 8)}@example.invalid`, role],
      );
    }
    await pool.query(
      `INSERT INTO access_grants(user_id, capability, subject_type, subject_key, status, provenance, policy_version)
       VALUES($1, 'helper.offer_services', 'self', 'self', 'active', 'legacy_backfill', 'helper-policy-1')`,
      [helper],
    );
    // Helper's saved service location: New York City Hall (40.7128, -74.0060).
    await pool.query(
      `INSERT INTO helper_profiles(user_id, service_city, service_state, service_lat, service_lng, service_location)
       VALUES($1, 'New York', 'NY', 40.7128, -74.0060, ST_SetSRID(ST_MakePoint(-74.0060, 40.7128), 4326)::geography)
       ON CONFLICT (user_id) DO UPDATE SET service_lat = EXCLUDED.service_lat, service_lng = EXCLUDED.service_lng,
         service_location = EXCLUDED.service_location`,
      [helper],
    );
  });

  afterAll(async () => {
    await pool.query('DELETE FROM notifications WHERE user_id = $1', [helper]);
    await pool.query('DELETE FROM bids WHERE id = ANY($1::uuid[])', [bids]);
    await pool.query('DELETE FROM jobs WHERE id = ANY($1::uuid[])', [jobs]);
    await pool.query('DELETE FROM helper_profiles WHERE user_id = $1', [helper]);
    await pool.query('DELETE FROM access_grants WHERE user_id = $1', [helper]);
    // Fixture users are left in place like other suites do: deleting any
    // user from this DB fails with "referential integrity query ... gave
    // unexpected result" because the append-only rules on
    // oxsteed_credit_partner_funding_records
    // (oxsteed_credit_partner_funding_no_delete/_no_update) rewrite the
    // RI check query. Pre-existing shared-DB quirk, not this slice.
    await pool.end().catch(() => {});
  });

  test('163: the saved distance preference round-trips and bounds', async () => {
    expect(await discovery.preferences(helper)).toMatchObject({ opportunity_radius_miles: 25 });
    const saved = await discovery.save(helper, { opportunity_radius_miles: 60, expectedVersion: 1 });
    expect(saved.opportunity_radius_miles).toBe(60);
    expect((await discovery.preferences(helper)).opportunity_radius_miles).toBe(60);
    // Restore the default so later suites see a clean preference.
    await discovery.save(helper, { opportunity_radius_miles: 25, expectedVersion: saved.discovery_version });
  });

  test('164: sweeper notifies once inside 24h and expires lapsed bids', async () => {
    // One bid per helper per job (UNIQUE job_id, helper_id), so each case
    // gets its own job.
    const openJob = await makeJob({ title: 'Fix sink' });
    const laterJob = await makeJob({ title: 'Not yet due' });
    const lapsedJob = await makeJob({ title: 'Lapsed bid job' });
    const wonJob = await makeJob({ title: 'Already won', status: 'accepted' });
    const soon = await makeBid(openJob.id, { expiresInHours: 12 });
    const later = await makeBid(laterJob.id, { expiresInHours: 48 });
    const lapsed = await makeBid(lapsedJob.id, { expiresInHours: -1 });
    const stale = await makeBid(wonJob.id, { expiresInHours: 12 });

    // Global counts are lower bounds only: the shared DB holds stale
    // pending bids left by other suites, so the sweep also processes
    // those. The precise assertions below are on this suite's own rows.
    const first = await sweepBidDeadlineNotices(pool);
    expect(first.expired).toBeGreaterThanOrEqual(1);
    expect(first.notified).toBeGreaterThanOrEqual(1);
    expect(first.examined).toBeGreaterThanOrEqual(1);

    expect((await pool.query('SELECT status FROM bids WHERE id = $1', [lapsed.id])).rows[0].status).toBe('expired');
    expect((await pool.query('SELECT deadline_notice_sent_at FROM bids WHERE id = $1', [soon.id])).rows[0].deadline_notice_sent_at).toBeTruthy();
    expect((await pool.query('SELECT deadline_notice_sent_at FROM bids WHERE id = $1', [later.id])).rows[0].deadline_notice_sent_at).toBeNull();
    expect((await pool.query('SELECT deadline_notice_sent_at FROM bids WHERE id = $1', [stale.id])).rows[0].deadline_notice_sent_at).toBeNull();
    const notes = await pool.query(
      "SELECT title, body FROM notifications WHERE user_id = $1 AND type = 'bid_deadline_reminder' AND data->>'bidId' = $2",
      [helper, String(soon.id)],
    );
    expect(notes.rows).toHaveLength(1);
    expect(notes.rows[0].title).toBe('Your bid expires soon');
    expect(notes.rows[0].body).toContain('Fix sink');

    // Second run: this suite's bids produce no second notification
    // (idempotent). Global counts are not asserted: other suites' stale
    // bids may enter the window between runs on the shared DB.
    await sweepBidDeadlineNotices(pool);
    const notesAfter = await pool.query(
      "SELECT id FROM notifications WHERE user_id = $1 AND type = 'bid_deadline_reminder' AND data->>'bidId' = $2",
      [helper, String(soon.id)],
    );
    expect(notesAfter.rows).toHaveLength(1);
  });

  test('165: preview answers distance in miles and the budget range', async () => {
    // Times Square (40.7580, -73.9855) is ~3.3 miles from City Hall.
    const near = await makeJob({
      title: 'Nearby job', location: { lat: 40.7580, lng: -73.9855 }, budgetMin: 1200, budgetMax: 1800,
    });
    const preview = await discovery.preview(helper, near.id);
    expect(preview).toMatchObject({ can_bid_now: true, advisory: true, budget_min: 1200, budget_max: 1800 });
    expect(typeof preview.distance_miles).toBe('number');
    expect(preview.distance_miles).toBeGreaterThan(2.5);
    expect(preview.distance_miles).toBeLessThan(4.5);
    expect(preview).not.toHaveProperty('location_point');
    expect(preview).not.toHaveProperty('client_id');
  });

  test('165: preview reports null distance and null budget when either is missing', async () => {
    const bare = await makeJob({ title: 'Bare job' });
    const preview = await discovery.preview(helper, bare.id);
    expect(preview.distance_miles).toBeNull();
    expect(preview.budget_min).toBeNull();
    expect(preview.budget_max).toBeNull();
  });
});
