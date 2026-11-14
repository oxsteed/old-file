'use strict';
// Cost audit 2026-11-13 item 11: the policy_notice_campaigns_notify
// trigger (migration 20261113103356) must fire pg_notify on the
// oxsteed_policy_notice channel when a campaign transitions to
// 'sending', and stay silent for other transitions. Uses the real
// database; skipped without one.
jest.unmock('pg');
const { Client } = require('pg');

// NB: __tests__/setup.js overwrites DATABASE_URL, so DB tests read the
// STATEMENT_TEST_DATABASE_URL variable directly (the repo convention).
const url = process.env.STATEMENT_TEST_DATABASE_URL || '';
const hasDb = url.includes('credit_statement_test');
const describeDb = hasDb ? describe : describe.skip;

jest.setTimeout(60000);

describeDb('policy notice notify trigger', () => {
  let listener;
  let pool;
  let version;

  beforeAll(async () => {
    const { Pool } = require('pg');
    pool = new Pool({ connectionString: url });
    listener = new Client({ connectionString: url });
    await listener.connect();
    await listener.query('LISTEN oxsteed_policy_notice');
    version = `test-notify-${Date.now()}`;
    await pool.query(
      `INSERT INTO policy_notice_campaigns(policy_version,status,planned_last_send_at,daily_cap,content_digest)
       VALUES($1,'scheduled',NOW()+interval '30 days',10,'test')`,
      [version],
    );
  });

  afterAll(async () => {
    if (listener) await listener.end().catch(() => {});
    if (pool) {
      await pool.query('DELETE FROM policy_notice_campaigns WHERE policy_version=$1', [version]).catch(() => {});
      await pool.end();
    }
  });

  test('transition to sending notifies, other transitions do not', async () => {
    const seen = [];
    listener.on('notification', (msg) => seen.push(msg.channel));
    // A status update that does not land on 'sending' stays silent.
    await pool.query(
      "UPDATE policy_notice_campaigns SET status='paused' WHERE policy_version=$1",
      [version],
    );
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(seen).toHaveLength(0);
    // The start transition wakes the delivery worker.
    await pool.query(
      "UPDATE policy_notice_campaigns SET status='sending' WHERE policy_version=$1",
      [version],
    );
    const deadline = Date.now() + 10000;
    while (seen.length === 0 && Date.now() < deadline)
      await new Promise((resolve) => setTimeout(resolve, 100));
    expect(seen).toEqual(['oxsteed_policy_notice']);
  });
});
