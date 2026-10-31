'use strict';

/**
 * Auth audit item 6: a step-up challenge binds the amount it was issued
 * for. Proves, through the real verifyStepupChallenge with a stateful
 * in-memory pg fake and email-method challenges seeded with a known code
 * hash (same HMAC the service uses):
 *   - a challenge issued for the expected amount verifies and consumes;
 *   - a challenge issued for a different amount rejects with
 *     credit_stepup_amount_mismatch, and the rejection neither consumes
 *     the challenge nor counts an attempt (a wrong-amount challenge is a
 *     caller mismatch, not a failed authentication; burning it would let
 *     anyone holding a challenge id destroy the owner's proof);
 *   - omitting the expected amount keeps legacy behavior (no binding);
 *   - a documented tolerance binds loosely: within tolerance passes,
 *     beyond it rejects;
 *   - malformed expected amounts and tolerances fail closed with 400.
 */

const { mockQuery, resetMocks } = require('./setup');
const crypto = require('crypto');
const { verifyStepupChallenge } = require('../services/stepupChallengeService');

const ACTOR = 'user-1';
const CODE = '123456';

function codeHash(code) {
  // Same pepper the service uses (setup sets JWT_SECRET; no step-up
  // pepper is configured in tests). Read it live, never hardcode it.
  return crypto.createHmac('sha256', process.env.JWT_SECRET).update(`stepup:${code}`).digest('hex');
}

let rows;
let consumeCalls;
let attemptCalls;

function seedChallenge(overrides = {}) {
  const row = {
    id: overrides.id || 'ch-1',
    actor_user_id: ACTOR,
    action_type: overrides.actionType || 'topup',
    amount_cents: overrides.amountCents ?? 10000,
    currency_code: 'USD',
    code_hash: codeHash(CODE),
    method: 'email',
    attempts: 0,
    max_attempts: 5,
    expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    consumed_at: null,
    created_at: new Date().toISOString(),
  };
  rows.set(row.id, row);
  return row;
}

function installFakeDb() {
  rows = new Map();
  consumeCalls = [];
  attemptCalls = [];
  mockQuery.mockImplementation(async (text, params = []) => {
    const sql = String(text);
    if (/^\s*BEGIN|^\s*COMMIT|^\s*ROLLBACK/.test(sql)) return { rows: [] };
    if (sql.includes('FROM oxsteed_credit_stepup_challenges WHERE id')) {
      const row = rows.get(params[0]);
      return { rows: row ? [{ ...row }] : [] };
    }
    if (sql.includes('SET consumed_at = NOW()')) {
      consumeCalls.push(params[0]);
      const row = rows.get(params[0]);
      if (row) row.consumed_at = new Date().toISOString();
      return { rows: [] };
    }
    if (sql.includes('SET attempts')) {
      attemptCalls.push(params[0]);
      const row = rows.get(params[0]);
      if (row) row.attempts = params[1];
      return { rows: [] };
    }
    throw new Error(`unexpected query in fake db: ${sql.slice(0, 120)}`);
  });
}

beforeEach(() => {
  resetMocks();
  jest.clearAllMocks();
  installFakeDb();
});

async function expectCode(promise, code) {
  try {
    await promise;
  } catch (err) {
    expect(err.code).toBe(code);
    return err;
  }
  throw new Error(`expected rejection with code ${code}`);
}

describe('item 6: step-up amount binding', () => {
  test('a challenge issued for the expected amount verifies and consumes', async () => {
    seedChallenge({ amountCents: 10000 });
    const result = await verifyStepupChallenge({
      challengeId: 'ch-1', actorUserId: ACTOR, actionType: 'topup', code: CODE, expectedAmountCents: 10000,
    });
    expect(result.verified).toBe(true);
    expect(consumeCalls).toEqual(['ch-1']);
    expect(rows.get('ch-1').consumed_at).not.toBeNull();
  });

  test('a mismatched amount rejects without consuming or counting an attempt', async () => {
    seedChallenge({ amountCents: 10000 });
    await expectCode(
      verifyStepupChallenge({
        challengeId: 'ch-1', actorUserId: ACTOR, actionType: 'topup', code: CODE, expectedAmountCents: 25000,
      }),
      'credit_stepup_amount_mismatch'
    );
    expect(consumeCalls).toEqual([]);
    expect(attemptCalls).toEqual([]);
    expect(rows.get('ch-1').consumed_at).toBeNull();
    expect(rows.get('ch-1').attempts).toBe(0);
    // The unconsumed challenge still verifies with the right amount.
    const result = await verifyStepupChallenge({
      challengeId: 'ch-1', actorUserId: ACTOR, actionType: 'topup', code: CODE, expectedAmountCents: 10000,
    });
    expect(result.verified).toBe(true);
  });

  test('omitting the expected amount keeps legacy unbound behavior', async () => {
    seedChallenge({ amountCents: 99999 });
    const result = await verifyStepupChallenge({
      challengeId: 'ch-1', actorUserId: ACTOR, actionType: 'topup', code: CODE,
    });
    expect(result.verified).toBe(true);
  });

  test('a documented tolerance passes within it and rejects beyond it', async () => {
    seedChallenge({ id: 'ch-within', amountCents: 10000 });
    const ok = await verifyStepupChallenge({
      challengeId: 'ch-within', actorUserId: ACTOR, actionType: 'topup', code: CODE,
      expectedAmountCents: 10005, amountToleranceCents: 10,
    });
    expect(ok.verified).toBe(true);

    seedChallenge({ id: 'ch-beyond', amountCents: 10000 });
    await expectCode(
      verifyStepupChallenge({
        challengeId: 'ch-beyond', actorUserId: ACTOR, actionType: 'topup', code: CODE,
        expectedAmountCents: 10020, amountToleranceCents: 10,
      }),
      'credit_stepup_amount_mismatch'
    );
    expect(rows.get('ch-beyond').consumed_at).toBeNull();
  });

  test('malformed expected amounts and tolerances fail closed with 400', async () => {
    seedChallenge({ amountCents: 10000 });
    for (const bad of [0, -5, 'abc', 1.5, Number.NaN]) {
      await expectCode(
        verifyStepupChallenge({
          challengeId: 'ch-1', actorUserId: ACTOR, actionType: 'topup', code: CODE, expectedAmountCents: bad,
        }),
        'credit_stepup_amount_invalid'
      );
    }
    await expectCode(
      verifyStepupChallenge({
        challengeId: 'ch-1', actorUserId: ACTOR, actionType: 'topup', code: CODE,
        expectedAmountCents: 10000, amountToleranceCents: -1,
      }),
      'credit_stepup_amount_invalid'
    );
    // Nothing was consumed by the malformed attempts.
    expect(consumeCalls).toEqual([]);
  });
});
