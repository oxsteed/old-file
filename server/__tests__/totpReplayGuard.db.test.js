'use strict';

// Domain 6 auth finding #7: the shared TOTP replay guard, exercised
// against the real database (atomic upsert) and across two real verify
// channels (TOTP setup, then payout-method step-up) with the same code.

// Explicit opt-in to the shared disposable synthetic database; never load .env.
jest.unmock('pg');
const databaseUrl = process.env.STATEMENT_TEST_DATABASE_URL;
const permitted = (() => {
  try {
    const u = new URL(databaseUrl);
    return ['postgres:', 'postgresql:'].includes(u.protocol)
      && ['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname)
      && u.pathname === '/credit_statement_test';
  } catch { return false; }
})();
if (permitted) process.env.DATABASE_URL = databaseUrl;
const dbDescribe = permitted ? describe : describe.skip;
const crypto = require('crypto');
const pool = require('../db');
const { consumeTotpCounter } = require('../services/totpReplayGuard');
const { encrypt } = require('../utils/encryption');
const { verifySetup } = require('../controllers/twoFactorController');
const { requireUserTotpStepUp } = require('../middleware/requireUserTotpStepUp');

test('TOTP replay-guard DB suite requires explicit synthetic disposable database opt-in', () => {
  expect(permitted).toBe(Boolean(databaseUrl && permitted));
});

dbDescribe('Domain 6 #7: totp_used_counters', () => {
  let userId;
  let otherId;
  let tag;

  beforeAll(async () => {
    tag = crypto.randomBytes(8).toString('hex');
    userId = crypto.randomUUID();
    otherId = crypto.randomUUID();
    for (const id of [userId, otherId]) {
      await pool.query(
        `INSERT INTO users(id, email, password_hash, first_name, last_name, role, email_verified, is_active)
         VALUES ($1, $2, 'synthetic-fixture', 'Synthetic', 'User', 'customer', true, true)`,
        [id, `totp-guard-${tag}-${id.slice(0, 8)}@example.test`]
      );
    }
  });

  afterAll(async () => {
    // Synthetic users are intentionally left behind: deleting users rows
    // is blocked schema-wide by the food_customer_wallet_ledger
    // append-only rewrite rule (known platform gap). Their tagged emails
    // never collide across runs. Only the guard rows are removed.
    await pool.query('DELETE FROM totp_used_counters WHERE user_id = ANY($1)', [[userId, otherId]]);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('first consume in a step succeeds, second in the same step is a replay', async () => {
    // Pin the clock mid-step so both consumes land in the same 30s step.
    const stepStart = 1780000000000 - (1780000000000 % 30000);
    jest.spyOn(Date, 'now').mockReturnValue(stepStart + 15000);
    expect(await consumeTotpCounter(pool, userId)).toBe(true);
    expect(await consumeTotpCounter(pool, userId)).toBe(false);
    const { rows } = await pool.query('SELECT max_counter FROM totp_used_counters WHERE user_id = $1', [userId]);
    expect(Number(rows[0].max_counter)).toBe(Math.floor((stepStart + 15000) / 30000));
  });

  test('a new step frees the counter again', async () => {
    const stepStart = 1780003600000 - (1780003600000 % 30000);
    jest.spyOn(Date, 'now').mockReturnValue(stepStart + 15000);
    expect(await consumeTotpCounter(pool, userId)).toBe(true);
    jest.spyOn(Date, 'now').mockReturnValue(stepStart + 15000 + 31000);
    expect(await consumeTotpCounter(pool, userId)).toBe(true);
  });

  test('counters are per user', async () => {
    const stepStart = 1780007200000 - (1780007200000 % 30000);
    jest.spyOn(Date, 'now').mockReturnValue(stepStart + 15000);
    expect(await consumeTotpCounter(pool, userId)).toBe(true);
    expect(await consumeTotpCounter(pool, otherId)).toBe(true);
    expect(await consumeTotpCounter(pool, userId)).toBe(false);
    expect(await consumeTotpCounter(pool, otherId)).toBe(false);
  });

  test('the same code cannot verify at TOTP setup and then at payout step-up', async () => {
    // Pin the clock mid-step so both presentations land in one step.
    const stepStart = 1780010800000 - (1780010800000 % 30000);
    jest.spyOn(Date, 'now').mockReturnValue(stepStart + 15000);
    await pool.query('UPDATE users SET totp_secret = $1, totp_enabled = false WHERE id = $2', [encrypt('TESTSECRET'), userId]);

    const res = { json: jest.fn() };
    const next = jest.fn();
    await verifySetup(
      { user: { id: userId }, body: { token: '123456' }, headers: {}, ip: '127.0.0.1' },
      res, next
    );
    expect(next).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: '2FA enabled successfully.' }));

    const out = await new Promise((resolve) => {
      const stepRes = { statusCode: null, body: null };
      stepRes.status = jest.fn((code) => { stepRes.statusCode = code; return stepRes; });
      stepRes.json = jest.fn((body) => { stepRes.body = body; resolve(stepRes); return stepRes; });
      const stepNext = jest.fn(() => resolve({ passed: true, next: stepNext }));
      requireUserTotpStepUp({ user: { id: userId }, body: { totp_code: '123456' } }, stepRes, stepNext);
    });
    expect(out.passed).toBeUndefined();
    expect(out.statusCode).toBe(403);
    expect(out.body).toMatchObject({ code: 'totp_stepup_invalid' });
  });
});
