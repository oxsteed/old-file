'use strict';

// G1-B1 (D-718, D-719): funding a planned need places a real Credit hold.
//
// POST /api/planned-needs/:id/fund holds the funded amount on the
// customer's own wallet (reserved_cents) and records a row in
// oxsteed_credit_reservations. The hold must NOT be blocked by the rail
// clearance gates (FEATURE_RAIL_CREDIT, FEATURE_PAYMENT_RAILS,
// credit_payment_legal_cleared) or by the rail's own enable flag: Emile's
// call is "Hold runs now, clearance aside" (2026-11-27 ~13:50 EST). The
// bypass is by construction — this path performs no paymentRailPolicy
// lookup and never routes through paymentRails/creditRail — and the
// operator freeze is still honored. The hold fails closed: insufficient
// balance, a frozen rail, or an unsupported currency refuses and leaves no
// reservation behind.
//
// Runs against the same dedicated fresh database as the fund-idempotency
// suite (credit_statement_test_g1ckpt1) so checkpoint fixtures never
// pollute the shared credit_statement_test DB.

jest.unmock('pg');
jest.unmock('../db');
jest.unmock('../utils/transaction');

// The rail flags are off for the whole file, set before any server module
// is required, so even a require-time read would see them off.
process.env.FEATURE_RAIL_CREDIT = 'false';
process.env.FEATURE_PAYMENT_RAILS = 'false';

const { randomUUID } = require('node:crypto');
const express = require('express');
const request = require('supertest');

const dbUrl = process.env.G1_CKPT1_TEST_DATABASE_URL;
if (dbUrl) {
  const url = new URL(dbUrl);
  if (!['postgres:', 'postgresql:'].includes(url.protocol)
    || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
    || url.pathname !== '/credit_statement_test_g1ckpt1') {
    throw new Error('Group 1 checkpoint 1 DB tests require the loopback credit_statement_test_g1ckpt1 database');
  }
  process.env.DATABASE_URL = dbUrl;
}

jest.mock('../middleware/auth', () => {
  const authenticate = (req, res, next) => {
    const id = req.get('x-test-user');
    if (!id) return res.sendStatus(401);
    req.user = {
      id,
      role: 'customer',
      email: req.get('x-test-email') || `g1b1-${id}@example.invalid`,
      email_verified: true,
    };
    return next();
  };
  return {
    authenticate,
    authenticateIfPresent: (req, res, next) => (
      req.get('x-test-user') ? authenticate(req, res, next) : next()
    ),
  };
});

const describeDb = dbUrl ? describe : describe.skip;

describeDb('G1-B1: planned-needs funding places a real Credit hold', () => {
  let db;
  let app;

  beforeAll(async () => {
    db = require('../db');
    app = express();
    app.use(express.json());
    app.use('/api/planned-needs', require('../routes/plannedNeeds'));
    app.use(require('../middleware/errorHandler').errorHandler);
  });

  afterAll(async () => { await db?.end(); });

  async function addUser({ preferredCurrency = null } = {}) {
    const id = randomUUID();
    const email = `g1b1-${id}@example.invalid`;
    await db.query(
      `INSERT INTO users (id, email, password_hash, first_name, last_name, role, default_mode, email_verified, is_active, onboarding_completed, didit_status, didit_verified_at)
       VALUES ($1, $2, 'x', 'B1', 'Fixture', 'customer', 'customer', TRUE, TRUE, TRUE, 'pending', NULL)`,
      [id, email],
    );
    if (preferredCurrency) {
      await db.query('UPDATE users SET preferred_currency = $2 WHERE id = $1', [id, preferredCurrency]);
    }
    return { id, email };
  }

  async function seedCredit(user, balanceCents = 100000) {
    // Migration 491 forbids INSERTing a non-empty ledger, so the synthetic
    // balance uses the established session_replication_role precedent
    // (creditSafeguardingAmlKyc.db.test.js).
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL session_replication_role = replica');
      await client.query(
        `INSERT INTO oxsteed_credit_accounts (account_type, customer_id, currency_code, balance_cents, reserved_cents, status)
         VALUES ('customer_wallet', $1, 'USD', $2, 0, 'active')`,
        [user.id, balanceCents],
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  async function makeNeed(user, { estimatedCost = 100, reservedAmount = 0 } = {}) {
    const { rows: [need] } = await db.query(
      `INSERT INTO planned_needs (user_id, title, category, status, due_date, estimated_cost, reserved_amount)
       VALUES ($1, 'Boiler service', 'other', 'planned', '2027-06-01', $2, $3)
       RETURNING id`,
      [user.id, estimatedCost, reservedAmount],
    );
    return need.id;
  }

  async function wallet(user) {
    const { rows: [row] } = await db.query(
      `SELECT balance_cents, reserved_cents, status FROM oxsteed_credit_accounts
        WHERE customer_id = $1 AND account_type = 'customer_wallet' AND currency_code = 'USD'`,
      [user.id],
    );
    return row ? { balanceCents: Number(row.balance_cents), reservedCents: Number(row.reserved_cents), status: row.status } : null;
  }

  async function holds(needId) {
    const { rows } = await db.query(
      `SELECT * FROM oxsteed_credit_reservations
        WHERE reference_type = 'planned_need_fund' AND reference_id LIKE $1
        ORDER BY created_at ASC`,
      [`planned-need-fund:${needId}:%`],
    );
    return rows;
  }

  async function auditEvents(actionType, resourceId) {
    const { rows } = await db.query(
      `SELECT * FROM oxsteed_credit_audit_events WHERE action_type = $1 AND resource_id = $2`,
      [actionType, String(resourceId)],
    );
    return rows;
  }

  function fund(needId, user, { amount, key } = {}) {
    const req = request(app)
      .post(`/api/planned-needs/${needId}/fund`)
      .set('x-test-user', user.id)
      .send({ amount });
    if (key) req.set('Idempotency-Key', key);
    return req;
  }

  function cancel(needId, user) {
    return request(app)
      .post(`/api/planned-needs/${needId}/cancel`)
      .set('x-test-user', user.id)
      .send({});
  }

  async function cleanup(user) {
    // Test-only teardown: delete the fixture reservations and restore the
    // wallet in the SAME transaction, because the migration-755 deferred
    // guard proves reserved_cents = SUM(active reservations) at commit.
    // Production never does this: it releases through releaseReservation.
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `DELETE FROM oxsteed_credit_reservations
          WHERE account_id IN (SELECT id FROM oxsteed_credit_accounts WHERE customer_id = $1)`,
        [user.id],
      );
      await client.query(
        'UPDATE oxsteed_credit_accounts SET reserved_cents = 0 WHERE customer_id = $1',
        [user.id],
      );
      await client.query('DELETE FROM planned_needs WHERE user_id = $1', [user.id]);
      await client.query('DELETE FROM oxsteed_credit_accounts WHERE customer_id = $1', [user.id]);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  test('the hold executes with the rail flags off and the rail disabled', async () => {
    const user = await addUser();
    await seedCredit(user);
    const needId = await makeNeed(user);
    try {
      // The rail itself is disabled in this DB (migration 422 seeds
      // oxsteed_credit_enabled FALSE) and the env rollout flags are off
      // for this whole file; the fixture user has no country, so no
      // per-country legal-clearance policy applies either. The hold must
      // still run: that is Emile's "hold runs now, clearance aside".
      const { rows: [flag] } = await db.query(
        "SELECT is_enabled FROM feature_flags WHERE key = 'oxsteed_credit_enabled'"
      );
      expect(flag.is_enabled).toBe(false);
      expect(process.env.FEATURE_RAIL_CREDIT).toBe('false');
      expect(process.env.FEATURE_PAYMENT_RAILS).toBe('false');

      const res = await fund(needId, user, { amount: 25, key: randomUUID() }).expect(200);
      expect(Number(res.body.reserved_amount)).toBe(25);

      const rows = await holds(needId);
      expect(rows).toHaveLength(1);
      expect(rows[0].status).toBe('active');
      expect(Number(rows[0].amount_cents)).toBe(2500);
      expect(rows[0].reference_type).toBe('planned_need_fund');
      expect(await wallet(user)).toEqual({ balanceCents: 100000, reservedCents: 2500, status: 'active' });
      expect(await auditEvents('credit.planned_need_hold.created', rows[0].id)).toHaveLength(1);
    } finally {
      await cleanup(user);
    }
  });

  test('concurrent same-key funds place exactly one hold (N11, money layer)', async () => {
    const user = await addUser();
    await seedCredit(user);
    const needId = await makeNeed(user);
    const key = randomUUID();
    try {
      const [first, second] = await Promise.all([
        fund(needId, user, { amount: 25, key }),
        fund(needId, user, { amount: 25, key }),
      ]);
      expect([first.status, second.status].sort()).toEqual([200, 200]);
      expect(first.body).toEqual(second.body);
      const { rows: [need] } = await db.query('SELECT reserved_amount FROM planned_needs WHERE id = $1', [needId]);
      expect(Number(need.reserved_amount)).toBe(25);
      expect(await holds(needId)).toHaveLength(1);
      expect((await wallet(user)).reservedCents).toBe(2500);
    } finally {
      await cleanup(user);
    }
  });

  test('insufficient balance refuses with 409 and leaves no reservation', async () => {
    const user = await addUser();
    await seedCredit(user, 1000); // $10.00
    const needId = await makeNeed(user);
    try {
      const res = await fund(needId, user, { amount: 25, key: randomUUID() }).expect(409);
      expect(res.body.code).toBe('credit_insufficient_funds');
      const { rows: [need] } = await db.query('SELECT reserved_amount FROM planned_needs WHERE id = $1', [needId]);
      expect(Number(need.reserved_amount)).toBe(0);
      expect(await holds(needId)).toHaveLength(0);
      expect((await wallet(user)).reservedCents).toBe(0);
    } finally {
      await cleanup(user);
    }
  });

  test('a customer with no Credit at all cannot fund (fail closed)', async () => {
    const user = await addUser();
    const needId = await makeNeed(user);
    try {
      const res = await fund(needId, user, { amount: 25, key: randomUUID() }).expect(409);
      expect(res.body.code).toBe('credit_insufficient_funds');
      const { rows: [need] } = await db.query('SELECT reserved_amount FROM planned_needs WHERE id = $1', [needId]);
      expect(Number(need.reserved_amount)).toBe(0);
      expect(await holds(needId)).toHaveLength(0);
    } finally {
      await cleanup(user);
    }
  });

  test('cancelling the need releases the hold back to the spendable balance', async () => {
    const user = await addUser();
    await seedCredit(user);
    const needId = await makeNeed(user);
    try {
      await fund(needId, user, { amount: 25, key: randomUUID() }).expect(200);
      expect((await wallet(user)).reservedCents).toBe(2500);

      const cancelled = await cancel(needId, user).expect(200);
      expect(cancelled.body.status).toBe('cancelled');

      const rows = await holds(needId);
      expect(rows).toHaveLength(1);
      expect(rows[0].status).toBe('released');
      expect(rows[0].released_reason).toBe('need_cancelled');
      expect((await wallet(user)).reservedCents).toBe(0);
      expect(await auditEvents('credit.planned_need_hold.released', rows[0].id)).toHaveLength(1);

      // Releasing twice is a no-op: the second cancel is refused as a
      // state error, and no second release event exists.
      await cancel(needId, user).expect(400);
      expect(await auditEvents('credit.planned_need_hold.released', rows[0].id)).toHaveLength(1);
    } finally {
      await cleanup(user);
    }
  });

  test('an open rail freeze refuses the fund with 503 and holds nothing', async () => {
    const user = await addUser();
    await seedCredit(user);
    const needId = await makeNeed(user);
    const { rows: [freeze] } = await db.query(
      "INSERT INTO oxsteed_credit_rail_freezes (reason) VALUES ('B1 fixture freeze') RETURNING id"
    );
    try {
      const res = await fund(needId, user, { amount: 25, key: randomUUID() }).expect(503);
      expect(res.body.code).toBe('credit_rail_frozen');
      const { rows: [need] } = await db.query('SELECT reserved_amount FROM planned_needs WHERE id = $1', [needId]);
      expect(Number(need.reserved_amount)).toBe(0);
      expect(await holds(needId)).toHaveLength(0);
    } finally {
      await db.query('DELETE FROM oxsteed_credit_rail_freezes WHERE id = $1', [freeze.id]);
      await cleanup(user);
    }
  });

  test('an unsupported currency refuses with 400 and holds nothing', async () => {
    const user = await addUser({ preferredCurrency: 'XXX' });
    await seedCredit(user);
    const needId = await makeNeed(user);
    try {
      const res = await fund(needId, user, { amount: 25, key: randomUUID() }).expect(400);
      expect(res.body.code).toBe('credit_currency_not_supported');
      const { rows: [need] } = await db.query('SELECT reserved_amount FROM planned_needs WHERE id = $1', [needId]);
      expect(Number(need.reserved_amount)).toBe(0);
      expect(await holds(needId)).toHaveLength(0);
    } finally {
      await cleanup(user);
    }
  });

  test('the hold matches the capped increment, not the requested amount', async () => {
    const user = await addUser();
    await seedCredit(user);
    // $80 of a $100 estimate already reserved; a $50 fund only adds $20.
    const needId = await makeNeed(user, { estimatedCost: 100, reservedAmount: 80 });
    try {
      const res = await fund(needId, user, { amount: 50, key: randomUUID() }).expect(200);
      expect(Number(res.body.reserved_amount)).toBe(100);
      const rows = await holds(needId);
      expect(rows).toHaveLength(1);
      expect(Number(rows[0].amount_cents)).toBe(2000);
      expect((await wallet(user)).reservedCents).toBe(2000);
    } finally {
      await cleanup(user);
    }
  });

  test('a fully funded need records no hold (existing 200 no-op)', async () => {
    const user = await addUser();
    await seedCredit(user);
    const needId = await makeNeed(user, { estimatedCost: 100, reservedAmount: 100 });
    try {
      const res = await fund(needId, user, { amount: 10, key: randomUUID() }).expect(200);
      expect(Number(res.body.reserved_amount)).toBe(100);
      expect(await holds(needId)).toHaveLength(0);
      expect((await wallet(user)).reservedCents).toBe(0);
    } finally {
      await cleanup(user);
    }
  });
});
