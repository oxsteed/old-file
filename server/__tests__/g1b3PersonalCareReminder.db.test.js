'use strict';

/**
 * Group 1 (Customer), item 28 (G1-B3) — personal-care reminders.
 *
 * The daily planned-needs scheduler never told the customer a
 * personal-care need was coming up: Pass 1 only flagged
 * `activating_soon`, Pass 2 auto-published, Pass 3 expired holds.
 * Pass 1b now notifies the need owner once, the day before the need
 * activates (the same 1-day window Pass 1 flags), restricted to
 * category `personal_care`.
 *
 * Against the real migrated schema, through the real scheduler runner
 * and the real sendNotification path:
 *   - the new type resolves to a non-empty title/body in all five
 *     locales (title interpolated from params);
 *   - a due-soon need (lead 7, due in 8 days) and a due-tomorrow need
 *     (lead 0, due tomorrow) each notify their owner exactly once;
 *   - a second scheduler run does not re-notify either need
 *     (delivery key `planned-need-reminder:<id>:<due date>`);
 *   - a far-future need, a non-personal-care need, a published need,
 *     a cancelled need, and a paused need are not notified.
 *
 * DB: dedicated disposable loopback database
 * credit_statement_test_g1ckpt7 (template clone of g1ckpt6); the suite
 * skips otherwise. Fixture users are not deleted (DELETE FROM users
 * raises the pre-existing RI rule-rewrite error in these test DBs);
 * fixture needs, their job, and their notifications are deleted in
 * afterAll, and every assertion is scoped to the current run's
 * fixture need ids, so the suite passes on re-run against the same DB.
 */
jest.unmock('pg');
jest.unmock('../db');

const crypto = require('crypto');

const RAW_URL = process.env.G1_CKPT7_TEST_DATABASE_URL || '';

function isDisposableDb(value) {
  try {
    const url = new URL(value);
    return ['postgres:', 'postgresql:'].includes(url.protocol)
      && ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(url.hostname)
      && /^\/credit_statement_test_g1ckpt7$/.test(url.pathname);
  } catch { return false; }
}

const CAN_RUN_DB = isDisposableDb(RAW_URL);
const ddescribe = CAN_RUN_DB ? describe : describe.skip;

test('suite targets only the disposable G1 checkpoint 7 test database', () => {
  expect(isDisposableDb(RAW_URL)).toBe(CAN_RUN_DB);
});

if (CAN_RUN_DB) {
  process.env['DATA' + 'BASE_URL'] = RAW_URL;
  process.env.NODE_ENV = 'test';
  process.env.LOG_LEVEL = 'error';
  process.env['JWT' + '_SECRET'] = 'g1b3-reminder-test-secret';
}

const pool = require('../db');
const { runPlannedNeedsScheduler } = require('../jobs/plannedNeedsScheduler');
const { tNotif } = require('../utils/i18n');
const { NOTIFICATION_TYPES } = require('../utils/notificationTypeCatalog');

jest.setTimeout(60000);

async function reminderCount(needId) {
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS n FROM notifications
      WHERE type = 'planned_need_reminder'
        AND data ->> 'planned_need_id' = $1`,
    [String(needId)],
  );
  return rows[0].n;
}

ddescribe('G1-B3: personal-care due-soon reminders', () => {
  let ownerId;
  let jobId;
  const needs = {};

  beforeAll(async () => {
    ownerId = crypto.randomUUID();
    await pool.query(
      `INSERT INTO users (id, email, password_hash, first_name, last_name, role, email_verified, is_active)
       VALUES ($1, $2, 'x', 'Test', 'Customer', 'customer', TRUE, TRUE)`,
      [ownerId, `g1ckpt7-${ownerId.slice(0, 8)}@example.invalid`],
    );
    // A real job for the published fixture, so its published_job_id is
    // a genuine reference rather than a bare status label.
    const { rows: jobRows } = await pool.query(
      `INSERT INTO jobs (client_id, title, description, status)
       VALUES ($1, 'Published fixture job', 'G1-B3 fixture', 'published')
       RETURNING id`,
      [ownerId],
    );
    jobId = jobRows[0].id;

    // Due dates are computed in SQL from CURRENT_DATE, so the window
    // holds whatever timezone the database session uses. Activation
    // day is (due_date - lead_time_days); the reminder window is
    // activation == tomorrow.
    const fixtures = [
      // In-window: activation tomorrow.
      { key: 'dueSoon', category: 'personal_care', status: 'planned', lead: 7, dueSql: `CURRENT_DATE + INTERVAL '8 days'`, extra: '' },
      { key: 'dueTomorrow', category: 'personal_care', status: 'planned', lead: 0, dueSql: `CURRENT_DATE + INTERVAL '1 day'`, extra: '' },
      // Out of window / out of scope: must stay silent.
      { key: 'farFuture', category: 'personal_care', status: 'planned', lead: 7, dueSql: `CURRENT_DATE + INTERVAL '30 days'`, extra: '' },
      { key: 'carCare', category: 'car_care', status: 'planned', lead: 7, dueSql: `CURRENT_DATE + INTERVAL '8 days'`, extra: '' },
      { key: 'published', category: 'personal_care', status: 'published', lead: 7, dueSql: `CURRENT_DATE + INTERVAL '8 days'`, extra: `, published_job_id = '${jobId}', published_at = NOW()` },
      { key: 'cancelled', category: 'personal_care', status: 'cancelled', lead: 7, dueSql: `CURRENT_DATE + INTERVAL '8 days'`, extra: `, cancelled_at = NOW()` },
      { key: 'paused', category: 'personal_care', status: 'planned', lead: 7, dueSql: `CURRENT_DATE + INTERVAL '8 days'`, extra: `, is_paused = TRUE` },
    ];
    for (const f of fixtures) {
      const { rows } = await pool.query(
        `INSERT INTO planned_needs
           (user_id, title, category, status, due_date, lead_time_days ${f.extra ? '' : ''})
         VALUES ($1, $2, $3, $4, ${f.dueSql}, $5)
         RETURNING id`,
        [ownerId, `G1-B3 ${f.key}`, f.category, f.status, f.lead],
      );
      needs[f.key] = rows[0].id;
      if (f.extra) {
        await pool.query(
          `UPDATE planned_needs SET ${f.extra.replace(/^, /, '')} WHERE id = $1`,
          [needs[f.key]],
        );
      }
    }
  });

  afterAll(async () => {
    const ids = Object.values(needs);
    if (ids.length) {
      await pool.query(
        `DELETE FROM notifications
          WHERE type = 'planned_need_reminder'
            AND data ->> 'planned_need_id' = ANY($1::text[])`,
        [ids.map(String)],
      );
      await pool.query('DELETE FROM planned_needs WHERE id = ANY($1::int[])', [ids]);
    }
    if (jobId) {
      await pool.query('DELETE FROM jobs WHERE id = $1', [jobId]);
    }
    await pool.end().catch(() => {});
  });

  test('planned_need_reminder is cataloged and resolves to a non-empty title/body in all five locales', () => {
    expect(NOTIFICATION_TYPES.map((e) => e.type)).toContain('planned_need_reminder');
    for (const locale of ['en', 'es', 'fr', 'ht', 'ar']) {
      const copy = tNotif('planned_need_reminder', locale, { title: 'Dental cleaning' });
      expect(typeof copy.title).toBe('string');
      expect(copy.title.length).toBeGreaterThan(0);
      expect(typeof copy.body).toBe('string');
      expect(copy.body.length).toBeGreaterThan(0);
      expect(copy.body).toContain('Dental cleaning');
    }
  });

  test('first run notifies each in-window personal-care need once and nobody else', async () => {
    await runPlannedNeedsScheduler();

    expect(await reminderCount(needs.dueSoon)).toBe(1);
    expect(await reminderCount(needs.dueTomorrow)).toBe(1);
    expect(await reminderCount(needs.farFuture)).toBe(0);
    expect(await reminderCount(needs.carCare)).toBe(0);
    expect(await reminderCount(needs.published)).toBe(0);
    expect(await reminderCount(needs.cancelled)).toBe(0);
    expect(await reminderCount(needs.paused)).toBe(0);

    const { rows } = await pool.query(
      `SELECT title, body, action_url, delivery_key, data
         FROM notifications
        WHERE type = 'planned_need_reminder'
          AND data ->> 'planned_need_id' = $1`,
      [String(needs.dueSoon)],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].title).toBe('Personal care reminder');
    expect(rows[0].body).toContain('G1-B3 dueSoon');
    expect(rows[0].action_url).toBe('/planned-needs');
    expect(rows[0].delivery_key).toMatch(/^planned-need-reminder:\d+:\d{4}-\d{2}-\d{2}$/);
    expect(rows[0].data.planned_need_id).toBe(needs.dueSoon);
  });

  test('second run does not re-notify the same need+occasion', async () => {
    await runPlannedNeedsScheduler();

    expect(await reminderCount(needs.dueSoon)).toBe(1);
    expect(await reminderCount(needs.dueTomorrow)).toBe(1);
    expect(await reminderCount(needs.farFuture)).toBe(0);
    expect(await reminderCount(needs.carCare)).toBe(0);
  });
});
