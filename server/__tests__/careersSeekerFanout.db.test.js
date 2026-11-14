'use strict';

/**
 * DB tests: Domain 9 items 1 + 8 — careers follower fan-out bounds and
 * job-alert batching (server/services/careers/marketplace/seeker.js).
 *
 * Repro-first: the cap/cursor tests FAIL on the unbounded code (tick 1
 * notifies all 250 followers at once, tick 2 notifies none because every
 * delivery key was already delivered, no outbox rows ever appear, one
 * Resend call fires per follower) and PASS once the per-opening cap, the
 * durable cursor and the email outbox land.
 *
 * Run with:
 *   CAREERS_TEST_DATABASE_URL=postgresql://oxsteed:statement-test-password@127.0.0.1:5432/careers_test \
 *     npx jest --runInBand __tests__/careersSeekerFanout.db.test.js
 */
jest.unmock('pg');
jest.unmock('../db');
jest.unmock('../utils/transaction');

const crypto = require('crypto');

const RAW_URL = process.env.CAREERS_TEST_DATABASE_URL || '';

function isTrackDatabase(value) {
  try {
    const url = new URL(value);
    return ['postgres:', 'postgresql:'].includes(url.protocol)
      && ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(url.hostname)
      && url.pathname === '/careers_test';
  } catch { return false; }
}

const CAN_RUN_DB = isTrackDatabase(RAW_URL);
const ddescribe = CAN_RUN_DB ? describe : describe.skip;

test('suite targets only the disposable careers_test database', () => {
  expect(isTrackDatabase(RAW_URL)).toBe(CAN_RUN_DB);
});

if (CAN_RUN_DB) {
  process.env.DATABASE_URL = RAW_URL;
  process.env.NODE_ENV = 'test';
  process.env.LOG_LEVEL = 'error';
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'careers-test-secret';
  process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'a'.repeat(64);
}

// The batch sender is mocked alongside the single sender: the fan-out must
// reach Resend through sendEmailBatch (bounded, ≤100 per call) and never
// through one sendEmail call per follower.
jest.mock('../utils/email', () => ({
  sendEmail: jest.fn().mockResolvedValue({ ok: true }),
  sendEmailBatch: jest.fn().mockResolvedValue([{ id: 'mock-batch-id' }]),
}));

jest.setTimeout(120000);

ddescribe('careers seeker fan-out bounds (real database)', () => {
  let pool;
  const ids = { followers: [], alertUsers: [], alerts: [], limitAlerts: [] };
  const email = () => require('../utils/email');

  async function newUser(label) {
    const id = crypto.randomUUID();
    await pool.query(
      `INSERT INTO users (id, email, password_hash, first_name, last_name, role, email_verified, onboarding_completed, is_active, created_at)
       VALUES ($1, $2, 'x', $3, 'Fixture', 'customer', TRUE, TRUE, TRUE, NOW())`,
      [id, `fanout-${label}-${id}@example.invalid`, label]
    );
    return id;
  }

  beforeAll(async () => {
    pool = require('../db');
    ids.owner = await newUser('owner');
    const { rows: [mk] } = await pool.query(
      `INSERT INTO businesses (user_id, business_name, is_business_verified, is_active, is_listed, setup_status, business_kind, profile_slug)
       VALUES ($1, 'Fanout Grill', TRUE, TRUE, TRUE, 'active', 'restaurant', $2) RETURNING id`,
      [ids.owner, `fanout-grill-${crypto.randomUUID().slice(0, 8)}`]
    );
    ids.biz = Number(mk.id);
    const { rows: [op] } = await pool.query(
      `INSERT INTO career_openings (employer_type, business_id, slug, title, status, moderation_status, is_internal, published_at, created_by, compensation_min, compensation_max, compensation_period)
       VALUES ('business', $1, 'fanout-cook', 'Fanout cook', 'open', 'ok', FALSE, NOW(), $2, 15, 20, 'hourly') RETURNING id`,
      [ids.biz, ids.owner]
    );
    ids.opening = Number(op.id);
    // 250 followers of the business.
    for (let i = 0; i < 250; i += 1) ids.followers.push(await newUser(`f${i}`));
    await pool.query(
      `INSERT INTO career_employer_follows (user_id, business_id, is_platform, notify)
       SELECT x, $1, FALSE, TRUE FROM unnest($2::uuid[]) AS x`,
      [ids.biz, ids.followers]
    );
  });

  afterAll(async () => {
    if (!pool) return;
    const allUsers = [ids.owner, ...ids.followers, ...ids.alertUsers].filter(Boolean);
    await pool.query('DELETE FROM career_job_alert_deliveries WHERE alert_id = ANY($1::bigint[])', [[...ids.alerts, ...ids.limitAlerts]]).catch(() => {});
    await pool.query('DELETE FROM career_job_alerts WHERE id = ANY($1::bigint[])', [[...ids.alerts, ...ids.limitAlerts]]).catch(() => {});
    await pool.query('DELETE FROM career_email_outbox WHERE delivery_key LIKE $1', [`career_follow_opening:${ids.opening}:%`]).catch(() => {});
    await pool.query('DELETE FROM career_email_outbox WHERE delivery_key LIKE $1', ['fanout-drain-test:%']).catch(() => {});
    await pool.query('DELETE FROM career_follow_notify_progress WHERE opening_id = $1', [ids.opening]).catch(() => {});
    await pool.query('DELETE FROM notifications WHERE delivery_key LIKE $1', [`career_follow_opening:${ids.opening}:%`]).catch(() => {});
    await pool.query('DELETE FROM notifications WHERE delivery_key LIKE $1', ['career_job_alert:%']).catch(() => {});
    await pool.query('DELETE FROM career_employer_follows WHERE business_id = $1', [ids.biz]).catch(() => {});
    await pool.query('DELETE FROM career_openings WHERE id = $1', [ids.opening]).catch(() => {});
    await pool.query('DELETE FROM businesses WHERE id = $1', [ids.biz]).catch(() => {});
    await pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [allUsers]).catch(() => {});
    await pool.end();
  });

  const notifiedUserIds = async () => {
    const { rows } = await pool.query(
      'SELECT user_id FROM notifications WHERE delivery_key LIKE $1 ORDER BY user_id',
      [`career_follow_opening:${ids.opening}:%`]
    );
    return rows.map((r) => r.user_id);
  };

  const outboxRows = async () => {
    const { rows } = await pool.query(
      'SELECT status, COUNT(*)::int AS n FROM career_email_outbox WHERE delivery_key LIKE $1 GROUP BY status ORDER BY status',
      [`career_follow_opening:${ids.opening}:%`]
    );
    return Object.fromEntries(rows.map((r) => [r.status, r.n]));
  };

  const flush = () => new Promise((resolve) => setTimeout(resolve, 50));

  test('item 1: per-opening follower cap holds and the durable cursor advances across ticks', async () => {
    const seeker = require('../services/careers/marketplace/seeker');
    const singleBefore = email().sendEmail.mock.calls.length;
    const batchBefore = email().sendEmailBatch.mock.calls.length;

    // Tick 1 delivers exactly the cap, not all 250 followers.
    await seeker.notifyFollowers(pool, { followersPerOpening: 100 });
    await flush();
    const tick1 = await notifiedUserIds();
    expect(tick1).toHaveLength(100);

    // Tick 2 resumes from the durable cursor: the NEXT 100 followers,
    // disjoint from tick 1, not a re-run of the same window.
    await seeker.notifyFollowers(pool, { followersPerOpening: 100 });
    await flush();
    const tick2 = (await notifiedUserIds()).filter((u) => !tick1.includes(u));
    expect(tick2).toHaveLength(100);
    expect(new Set([...tick1, ...tick2]).size).toBe(200);

    // Tick 3 delivers the last 50 and marks the opening complete; tick 4
    // sends nothing more.
    await seeker.notifyFollowers(pool, { followersPerOpening: 100 });
    await flush();
    expect(await notifiedUserIds()).toHaveLength(250);
    const { rows: [progress] } = await pool.query(
      'SELECT last_user_id, completed_at FROM career_follow_notify_progress WHERE opening_id = $1',
      [ids.opening]
    );
    expect(progress).toBeDefined();
    expect(progress.completed_at).not.toBeNull();
    await seeker.notifyFollowers(pool, { followersPerOpening: 100 });
    await flush();
    expect(await notifiedUserIds()).toHaveLength(250);

    // Email went through the bounded batch sender, never one Resend call
    // per follower.
    expect(email().sendEmail.mock.calls.length - singleBefore).toBe(0);
    expect(email().sendEmailBatch.mock.calls.length - batchBefore).toBeGreaterThan(0);
    for (const call of email().sendEmailBatch.mock.calls.slice(batchBefore)) {
      expect(call[0].length).toBeLessThanOrEqual(100);
    }
  });

  test('item 1: fan-out emails are queued in the outbox, not sent inline per follower', async () => {
    // The previous test already delivered all 250 followers; the outbox
    // holds one row per fresh notification.
    const counts = await outboxRows();
    expect(counts.sent || 0).toBe(250);
    expect(counts.pending || 0).toBe(0);
  });

  test('item 1: outbox drain retries a failed batch instead of losing the email', async () => {
    const delivery = require('../services/careers/marketplace/delivery');
    const userId = ids.followers[0];
    await pool.query(
      `INSERT INTO career_email_outbox (delivery_key, user_id, email, language, type, params, action_url)
       VALUES ('fanout-drain-test:1', $1, 'fanout-drain@example.invalid', 'en', 'career_followed_employer_opening',
               '{"employerName":"Fanout Grill","openingTitle":"Fanout cook"}'::jsonb, $2)`,
      [userId, `/careers/${ids.opening}`]
    );
    email().sendEmailBatch.mockRejectedValueOnce(new Error('resend down'));
    const first = await delivery.drainCareerEmailOutbox(pool);
    expect(first.failed).toBeGreaterThanOrEqual(1);
    let { rows: [row] } = await pool.query(
      "SELECT status, attempts FROM career_email_outbox WHERE delivery_key = 'fanout-drain-test:1'"
    );
    expect(row.status).toBe('pending');
    expect(row.attempts).toBe(1);
    const second = await delivery.drainCareerEmailOutbox(pool);
    expect(second.sent).toBeGreaterThanOrEqual(1);
    ({ rows: [row] } = await pool.query(
      "SELECT status FROM career_email_outbox WHERE delivery_key = 'fanout-drain-test:1'"
    ));
    expect(row.status).toBe('sent');
  });

  test('item 8: alerts sharing criteria share one search, and every alert is still delivered once', async () => {
    const seeker = require('../services/careers/marketplace/seeker');
    const openings = require('../services/careers/openings');
    for (let i = 0; i < 5; i += 1) ids.alertUsers.push(await newUser(`alert${i}`));
    for (const userId of ids.alertUsers) {
      const { rows: [a] } = await pool.query(
        `INSERT INTO career_job_alerts (user_id, name, criteria, frequency, channels, paused, last_checked_at)
         VALUES ($1, 'Cooks', '{"q":"cook"}'::jsonb, 'instant', ARRAY['email','in_app']::text[], FALSE, NOW() - INTERVAL '2 days')
         RETURNING id`,
        [userId]
      );
      ids.alerts.push(Number(a.id));
    }
    // No other alert may be due during this run, so the search count is exact.
    await pool.query('UPDATE career_job_alerts SET last_checked_at = NOW() WHERE id <> ALL($1::bigint[])', [ids.alerts]);
    const spy = jest.spyOn(openings, 'listPublic');
    try {
      const result = await seeker.runDueAlerts(pool);
      expect(result.checked).toBe(5);
      expect(result.sent).toBe(5);
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      spy.mockRestore();
    }
    const { rows } = await pool.query(
      'SELECT alert_id, COUNT(*)::int AS n, COUNT(DISTINCT opening_id)::int AS d FROM career_job_alert_deliveries WHERE alert_id = ANY($1::bigint[]) GROUP BY alert_id',
      [ids.alerts]
    );
    expect(rows).toHaveLength(5);
    for (const r of rows) {
      expect(r.n).toBe(r.d);
      expect(r.n).toBeGreaterThanOrEqual(1);
    }
  });

  test('item 8: per-tick alert count is bounded at 100 and unprocessed alerts keep their place', async () => {
    const seeker = require('../services/careers/marketplace/seeker');
    const userId = ids.alertUsers[0];
    for (let i = 0; i < 150; i += 1) {
      const { rows: [a] } = await pool.query(
        `INSERT INTO career_job_alerts (user_id, name, criteria, frequency, channels, paused, last_checked_at)
         VALUES ($1, $2, '{"q":"zzzz-no-match"}'::jsonb, 'instant', ARRAY['email','in_app']::text[], FALSE, NOW() - INTERVAL '2 days')
         RETURNING id`,
        [userId, `No match ${i}`]
      );
      ids.limitAlerts.push(Number(a.id));
    }
    await pool.query('UPDATE career_job_alerts SET last_checked_at = NOW() WHERE id <> ALL($1::bigint[])', [ids.limitAlerts]);
    const result = await seeker.runDueAlerts(pool);
    expect(result.checked).toBe(100);
    expect(result.sent).toBe(0);
    const { rows: [{ untouched }] } = await pool.query(
      "SELECT COUNT(*)::int AS untouched FROM career_job_alerts WHERE id = ANY($1::bigint[]) AND last_checked_at <= NOW() - INTERVAL '2 days'",
      [ids.limitAlerts]
    );
    expect(untouched).toBe(50);
  });
});
