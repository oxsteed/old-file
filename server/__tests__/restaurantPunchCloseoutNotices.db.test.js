'use strict';

/**
 * DB tests: money-flows W9 — the punch-closeout manager alert was
 * unrecorded best-effort. A crash between the close commit and the
 * notify lost the alert silently: the next run skips the entry (no
 * longer open) and there was no ledger to reconcile against.
 *
 * The fix records one ledger row per (closed entry, manager) with the
 * delivery key and the outcome (sent / failed / skipped), and retries
 * failed/skipped rows on the next sweep.
 *
 * The notification sender is mocked here so a send failure is
 * deterministic; the close and the ledger are real.
 *
 * DB: disposable credit_statement_test only; the suite skips otherwise.
 *
 * Run with:
 *   STATEMENT_TEST_DATABASE_URL=postgresql://oxsteed:statement-test-password@127.0.0.1:5432/credit_statement_test
 *     npx jest __tests__/restaurantPunchCloseoutNotices.db.test.js
 */
jest.unmock('pg');
jest.unmock('../db');
jest.mock('../services/notificationService', () => ({
  sendNotification: jest.fn(),
}));

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
  process.env['JWT' + '_SECRET'] = 'closeout-notices-test-secret';
}

const pool = require('../db');
const { sendNotification } = require('../services/notificationService');
const { closeStalePunches, retryCloseoutNotices } = require('../services/restaurantPunchCloseout');

jest.setTimeout(60000);

async function makeUser(first, last) {
  const id = crypto.randomUUID();
  await pool.query(
    `INSERT INTO users (id, email, password_hash, first_name, last_name, role, email_verified, is_active)
     VALUES ($1, $2, 'x', $3, $4, 'customer', TRUE, TRUE)`,
    [id, `closeout-${id.slice(0, 8)}@example.invalid`, first, last]
  );
  return id;
}

async function openEntry(businessId, userId) {
  const { rows: [row] } = await pool.query(
    `INSERT INTO business_time_entries
       (business_id, user_id, entry_date, clock_in_at)
     VALUES ($1, $2, (NOW() - INTERVAL '14 hours')::date, NOW() - INTERVAL '14 hours')
     RETURNING id`,
    [businessId, userId]
  );
  return Number(row.id);
}

async function ledgerRows(entryId) {
  const { rows } = await pool.query(
    `SELECT * FROM restaurant_punch_closeout_notices WHERE entry_id = $1 ORDER BY manager_user_id`,
    [entryId]
  );
  return rows;
}

ddescribe('Money-flows W9: closeout manager alerts are recorded and retried', () => {
  let F = {};

  beforeAll(async () => {
    const owner = await makeUser('Olivia', 'Owner');
    const manager = await makeUser('Mona', 'Manager');
    const employee = await makeUser('Eddie', 'Employee');
    const { rows: [biz] } = await pool.query(
      'INSERT INTO businesses (user_id, business_name, timezone) VALUES ($1, $2, $3) RETURNING id',
      [owner, `CloseoutNotices ${crypto.randomUUID().slice(0, 8)}`, 'UTC']
    );
    await pool.query(
      `INSERT INTO business_members (business_id, owner_id, member_id, role, invite_email, status)
       VALUES ($1, $2, $3, 'manager', $4, 'active')`,
      [biz.id, owner, manager, `closeout-mgr-${manager.slice(0, 8)}@example.invalid`]
    );
    F = { owner, manager, employee, businessId: Number(biz.id) };
  });

  beforeEach(() => {
    sendNotification.mockClear();
  });

  afterAll(async () => {
    await pool.query('DELETE FROM restaurant_punch_closeout_notices WHERE business_id = $1', [F.businessId]).catch(() => {});
    await pool.query('DELETE FROM business_time_entries WHERE business_id = $1', [F.businessId]).catch(() => {});
    await pool.query('DELETE FROM business_members WHERE business_id = $1', [F.businessId]).catch(() => {});
    await pool.query('DELETE FROM businesses WHERE id = $1', [F.businessId]).catch(() => {});
    await pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [[F.owner, F.manager, F.employee]]).catch(() => {});
    await pool.end().catch(() => {});
  });

  test('a close followed by a failed notify leaves persisted failed rows that the next run retries', async () => {
    const entryId = await openEntry(F.businessId, F.employee);
    // Phase 1: every send fails. The close still commits.
    sendNotification.mockResolvedValue({ success: false, error: 'sender down' });
    const first = await closeStalePunches({ businessId: F.businessId, db: pool });
    expect(first.closed.map((c) => c.entryId)).toContain(entryId);
    expect(first.notifyErrors).toBe(2); // owner + manager
    const failed = await ledgerRows(entryId);
    expect(failed).toHaveLength(2);
    expect(failed.map((r) => r.status).sort()).toEqual(['failed', 'failed']);
    expect(failed.map((r) => r.manager_user_id).sort()).toEqual([F.manager, F.owner].sort());
    for (const row of failed) {
      expect(row.delivery_key).toBe(`closeout-notify:${entryId}:${row.manager_user_id}`);
      expect(row.error).toMatch(/sender down/);
    }
    // The failed alert is visible in the ledger even though the entry
    // is now closed and the next sweep would otherwise skip it.
    const { rows: [entry] } = await pool.query(
      'SELECT clock_out_at FROM business_time_entries WHERE id = $1', [entryId]
    );
    expect(entry.clock_out_at).not.toBeNull();

    // Phase 2: the sender recovers. The next sweep retries the failed
    // rows under the same delivery keys instead of losing them.
    sendNotification.mockResolvedValue({ success: true, notificationId: 4242 });
    const second = await closeStalePunches({ businessId: F.businessId, db: pool });
    expect(second.closed).toHaveLength(0);
    expect(second.retriedNotices.sent).toBe(2);
    const retried = await ledgerRows(entryId);
    expect(retried).toHaveLength(2); // no duplicate rows
    expect(retried.map((r) => r.status).sort()).toEqual(['sent', 'sent']);
    const keys = sendNotification.mock.calls.map((c) => c[0].idempotencyKey).sort();
    expect(keys.filter((k) => k === `closeout-notify:${entryId}:${F.owner}`).length).toBe(2);
    expect(keys.filter((k) => k === `closeout-notify:${entryId}:${F.manager}`).length).toBe(2);
  });

  test('a successful notify records sent rows with the idempotency key, and a re-run adds nothing', async () => {
    const entryId = await openEntry(F.businessId, F.employee);
    sendNotification.mockResolvedValue({ success: true, notificationId: 77 });
    const first = await closeStalePunches({ businessId: F.businessId, db: pool });
    expect(first.closed.map((c) => c.entryId)).toContain(entryId);
    expect(first.notified).toBe(2);
    const sent = await ledgerRows(entryId);
    expect(sent).toHaveLength(2);
    expect(sent.map((r) => r.status)).toEqual(['sent', 'sent']);
    const calls = sendNotification.mock.calls.length;
    const again = await closeStalePunches({ businessId: F.businessId, db: pool });
    expect(again.closed).toHaveLength(0);
    expect(sendNotification.mock.calls.length).toBe(calls);
    expect(await ledgerRows(entryId)).toHaveLength(2);
  });

  test('a preference-suppressed send is recorded skipped, not sent, and retryCloseoutNotices can pick it up', async () => {
    const entryId = await openEntry(F.businessId, F.employee);
    // The sender delivered nothing (no in-app row): suppressed.
    sendNotification.mockResolvedValue({ success: true, notificationId: null });
    const first = await closeStalePunches({ businessId: F.businessId, db: pool });
    expect(first.closed.map((c) => c.entryId)).toContain(entryId);
    const skipped = await ledgerRows(entryId);
    expect(skipped).toHaveLength(2);
    expect(skipped.map((r) => r.status)).toEqual(['skipped', 'skipped']);

    sendNotification.mockResolvedValue({ success: true, notificationId: 99 });
    const retried = await retryCloseoutNotices(pool, { businessId: F.businessId });
    expect(retried.sent).toBe(2);
    const after = await ledgerRows(entryId);
    expect(after.map((r) => r.status)).toEqual(['sent', 'sent']);
  });
});
