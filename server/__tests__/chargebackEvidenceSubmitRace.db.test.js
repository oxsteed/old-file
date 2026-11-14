'use strict';

// Domain 7 #10 (real-database repro): two concurrent submitEvidence calls
// against one unsubmitted chargeback must push evidence to Stripe exactly
// once, with the loser rejected 409 already_submitted.
//
// The fix takes SELECT ... FOR UPDATE on the stripe_chargebacks row inside
// a transaction before the Stripe push, so the loser blocks until the
// winner stamps evidence_submitted_at. On the unfixed code both calls
// pass the plain-SELECT check and both push, so this test fails there
// (two Stripe pushes, both fulfilled).
//
// Only the Stripe network boundary is mocked. The row lives in a
// disposable schema that shadows public.stripe_chargebacks via
// search_path, so parallel tracks sharing the test database cannot
// collide; buildEvidence's reads fall through to the public payments /
// food_orders tables (no matching rows) and the evidence is assembled
// from the dispute record alone.
//
// Explicit opt-in to the shared disposable synthetic database; never load .env.

const crypto = require('crypto');

const schema = `cb_race_${crypto.randomBytes(6).toString('hex')}`;
const databaseUrl = process.env.STATEMENT_TEST_DATABASE_URL;
const permitted = (() => {
  try {
    const u = new URL(databaseUrl);
    return ['postgres:', 'postgresql:'].includes(u.protocol)
      && ['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname)
      && u.pathname === '/credit_statement_test';
  } catch { return false; }
})();
if (permitted) {
  const target = new URL(databaseUrl);
  target.searchParams.set('options', `-c search_path=${schema},public`);
  process.env.DATABASE_URL = target.toString();
}
jest.unmock('pg');
jest.unmock('../db');
jest.unmock('../utils/transaction');

process.env.STRIPE_SECRET_KEY = 'sk_test_synthetic_chargeback_race';
const mockDisputesUpdate = jest.fn();
jest.mock('stripe', () => () => ({ disputes: { update: mockDisputesUpdate } }));

const db = require('../db');
const svc = require('../services/chargebackEvidenceService');

const dbDescribe = permitted ? describe : describe.skip;
const ADMIN_A = '00000000-0000-0000-0000-000000000001';
const ADMIN_B = '00000000-0000-0000-0000-000000000002';

dbDescribe('Domain 7 #10: concurrent double-submit against the real database', () => {
  beforeAll(async () => {
    await db.query(`CREATE SCHEMA ${schema}`);
    await db.query(`CREATE TABLE ${schema}.stripe_chargebacks (
      id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      stripe_dispute_id TEXT NOT NULL,
      stripe_account_id TEXT,
      stripe_charge_id TEXT,
      stripe_payment_intent_id TEXT,
      amount_cents BIGINT NOT NULL DEFAULT 0,
      currency_code TEXT NOT NULL DEFAULT 'USD',
      reason TEXT,
      stripe_status TEXT NOT NULL,
      evidence_due_by TIMESTAMPTZ,
      has_evidence BOOLEAN NOT NULL DEFAULT FALSE,
      submission_count INTEGER NOT NULL DEFAULT 0,
      evidence_staged_at TIMESTAMPTZ,
      evidence_submitted_at TIMESTAMPTZ,
      submitted_by UUID,
      auto_submitted BOOLEAN NOT NULL DEFAULT FALSE,
      evidence_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
      last_error TEXT,
      attempts INTEGER NOT NULL DEFAULT 0,
      payment_id BIGINT,
      food_order_id BIGINT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
  });

  afterAll(async () => {
    await db.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await db.end();
  });

  beforeEach(async () => {
    mockDisputesUpdate.mockReset().mockResolvedValue({ id: 'dp_race' });
    await db.query(`TRUNCATE ${schema}.stripe_chargebacks RESTART IDENTITY`);
  });

  test('concurrent double-submit pushes to Stripe exactly once; the loser gets 409', async () => {
    const disputeId = `dp_race_${crypto.randomBytes(6).toString('hex')}`;
    const { rows: [row] } = await db.query(
      `INSERT INTO stripe_chargebacks
         (stripe_dispute_id, stripe_charge_id, stripe_payment_intent_id, amount_cents, currency_code, reason, stripe_status, evidence_due_by)
       VALUES ($1, 'ch_race', 'pi_race', 5000, 'usd', 'fraudulent', 'needs_response', NOW() + INTERVAL '7 days')
       RETURNING id`,
      [disputeId]
    );
    const results = await Promise.allSettled([
      svc.submitEvidence(row.id, { actorId: ADMIN_A }),
      svc.submitEvidence(row.id, { actorId: ADMIN_B }),
    ]);
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toMatchObject({ code: 'already_submitted', status: 409 });
    expect(mockDisputesUpdate).toHaveBeenCalledTimes(1);
    expect(mockDisputesUpdate).toHaveBeenCalledWith(
      disputeId, expect.objectContaining({ submit: true }), undefined
    );
    const { rows: [after] } = await db.query(
      `SELECT evidence_submitted_at, attempts FROM stripe_chargebacks WHERE id = $1`, [row.id]
    );
    expect(after.evidence_submitted_at).not.toBeNull();
    expect(after.attempts).toBe(1);
  });
});
