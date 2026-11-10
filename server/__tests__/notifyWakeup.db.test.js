'use strict';
// Cost audit 2026-11-04 item 7: the LISTEN/NOTIFY wakeup delivers a
// callback when a row's insert is notified, and unsubscribe stops
// delivery. Uses the real pg client (jest.unmock) against the disposable
// test database; skipped without one. The notify half of the feature is
// the migration's AFTER INSERT trigger; this test covers the LISTEN half
// with an explicit pg_notify, which is exactly what the trigger issues.
jest.unmock('pg');
const { subscribe, stop, getStatus } = require('../utils/notifyWakeup');

const url = process.env.DATABASE_URL || process.env.STATEMENT_TEST_DATABASE_URL || '';
const hasDb = url.includes('credit_statement_test');
const describeDb = hasDb ? describe : describe.skip;

jest.setTimeout(60000);

afterEach(async () => {
  await stop();
});

test('subscribe without a database URL never throws', async () => {
  const saved = process.env.DATABASE_URL;
  delete process.env.DATABASE_URL;
  try {
    expect(() => subscribe('oxsteed_screen_events', jest.fn())).not.toThrow();
    await new Promise((resolve) => setImmediate(resolve));
  } finally {
    if (saved === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = saved;
  }
});

describeDb('notify wakeup against Postgres', () => {
  let pool;
  beforeAll(async () => {
    const { Pool } = require('pg');
    pool = new Pool({ connectionString: url });
  });
  afterAll(async () => {
    if (pool) await pool.end();
  });

  test('a subscriber fires on notify and stops after unsubscribe', async () => {
    const cb = jest.fn();
    const unsub = subscribe('oxsteed_screen_events', cb);
    const deadline = Date.now() + 10000;
    while (cb.mock.calls.length === 0 && Date.now() < deadline) {
      await pool.query(`SELECT pg_notify('oxsteed_screen_events', '')`);
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    expect(cb).toHaveBeenCalledTimes(1);
    await pool.query(`SELECT pg_notify('oxsteed_activity_outbox', '')`);
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(cb).toHaveBeenCalledTimes(1);
    unsub();
    await pool.query(`SELECT pg_notify('oxsteed_screen_events', '')`);
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(cb).toHaveBeenCalledTimes(1);
  });

  test('the last unsubscribe ends the dedicated LISTEN client', async () => {
    const saved = process.env.DATABASE_URL;
    process.env.DATABASE_URL = url;
    try {
      const unsub = subscribe('oxsteed_screen_events', jest.fn());
      const openDeadline = Date.now() + 10000;
      while (!getStatus().connected && Date.now() < openDeadline) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      expect(getStatus()).toMatchObject({
        connected: true,
        channels: ['oxsteed_screen_events'],
      });
      unsub();
      const closeDeadline = Date.now() + 10000;
      while ((getStatus().connected || getStatus().connecting) && Date.now() < closeDeadline) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      expect(getStatus()).toEqual({
        connected: false,
        connecting: false,
        channels: [],
      });
    } finally {
      if (saved === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = saved;
    }
  });
});
