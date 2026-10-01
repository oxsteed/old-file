'use strict';

/**
 * OxSteed Credit restaurant conversion allowlist tests (Emile's requirement).
 *
 * (a) Gate: convertRestaurantToOxsteed rejects with 403
 *     credit_conversion_restaurant_not_enabled when the restaurant has no
 *     policy row (default-deny) and the food-wallet debit is never called;
 *     it succeeds when the row has allow_restaurant_to_oxsteed = true.
 * (b) Maker-checker: toggling the flag queues without executing, the maker
 *     cannot self-approve (403), and the checker executes exactly once.
 * (c) Idempotency: replaying an already-executed conversion with the same
 *     idempotency key returns the stored result (the gate does not break the
 *     existing replay path); a different-parameter replay still conflicts.
 * (d) Validation: validateConversionPolicyInput rejects bad input with 400
 *     before anything is queued.
 * (e) Migration 642: the policy table exists with default-deny semantics
 *     and no seed rows enabling anything.
 * (f) to_restaurant active-partner gate: convertOxsteedToRestaurant rejects
 *     with 403 credit_conversion_restaurant_not_enabled when there is no
 *     active oxsteed_credit_partners row (the customer OxSteed wallet is
 *     untouched); an active row allows the conversion; a pending row does
 *     NOT satisfy the gate.
 */

const fs = require('fs');
const path = require('path');
const { mockQuery, resetMocks } = require('./setup');

jest.mock('../services/stepupChallengeService', () => {
  const actual = jest.requireActual('../services/stepupChallengeService');
  return { ...actual, verifyStepupChallenge: jest.fn().mockResolvedValue({ verified: true }) };
});
// debitFoodWallet/creditFoodWallet are destructured at require time by the
// conversion service; the mock must be module-level so the references are captured.
jest.mock('../services/foodWalletService', () => {
  const actual = jest.requireActual('../services/foodWalletService');
  return { ...actual, debitFoodWallet: jest.fn(), creditFoodWallet: jest.fn() };
});
// postFoodWalletDualEntry is also destructured at require time; the real
// implementation would auto-provision partners and post journal legs, which
// is machinery the gate tests do not need.
jest.mock('../services/oxsteedCreditSubBankService', () => {
  const actual = jest.requireActual('../services/oxsteedCreditSubBankService');
  return { ...actual, postFoodWalletDualEntry: jest.fn() };
});
// The policy service keeps its real gate functions; only the write is
// mocked so the maker-checker tests can assert execute-once semantics.
jest.mock('../services/oxsteedCreditRestaurantConversionPolicyService', () => {
  const actual = jest.requireActual('../services/oxsteedCreditRestaurantConversionPolicyService');
  return { ...actual, upsertRestaurantConversionPolicy: jest.fn() };
});
// assertSanctionsClear is required lazily inside the conversion; mock the
// module so it resolves without touching the screening tables.
jest.mock('../services/sanctionsScreeningService', () => ({
  assertSanctionsClear: jest.fn().mockResolvedValue({ clear: true }),
}));

const { convertRestaurantToOxsteed, convertOxsteedToRestaurant } = require('../services/oxsteedCreditRestaurantConversionService');
const { debitFoodWallet, creditFoodWallet } = require('../services/foodWalletService');
const { postFoodWalletDualEntry } = require('../services/oxsteedCreditSubBankService');
const policyService = require('../services/oxsteedCreditRestaurantConversionPolicyService');
const { requestPendingAction, decidePendingAction } = require('../services/oxsteedCreditPendingActionService');

const CUSTOMER_ID = '11111111-1111-4111-8111-111111111111';
const MAKER_ID = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
const CHECKER_ID = 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb';
const ACTION_ID = 'cccccccc-cccc-4ccc-cccc-cccccccccccc';
const RESTAURANT_ID = 42;

// ── Mutable router state ────────────────────────────────────────────────
let railEnabled;
let policyRow; // null = no row (default-deny), else { allow_restaurant_to_oxsteed }
let partnerRow; // null = no partner row, else { id, status: 'active' | 'pending' | ... }
let existingConversionRow;
let pendingActionRow;
let pendingActionDecidedStatus;

function conversionRowFromParams(params, direction = 'from_restaurant') {
  return {
    id: params[0],
    customer_id: params[1],
    restaurant_id: params[2],
    direction,
    source_amount_cents: params[3],
    converted_amount_cents: params[4],
    fee_cents: params[5],
    currency_code: params[6],
    rate: params[7],
    status: 'completed',
    wallet_ledger_entry_id: params[8],
    journal_transaction_id: params[9],
    journal_fee_transaction_id: params[10],
    idempotency_key: params[11],
    actor_user_id: params[12],
    created_at: '2026-10-01T12:00:00.000Z',
  };
}

function installRouter() {
  mockQuery.mockImplementation((sql, params = []) => {
    const s = String(sql);
    if (s === 'BEGIN' || s === 'COMMIT' || s === 'ROLLBACK') return { rows: [] };
    if (s.startsWith('SAVEPOINT') || s.startsWith('RELEASE SAVEPOINT') || s.startsWith('ROLLBACK TO SAVEPOINT')) {
      return { rows: [] };
    }
    if (s.includes('pg_advisory_xact_lock')) return { rows: [] };
    // Rail gate.
    if (s.includes("FROM feature_flags WHERE key = 'oxsteed_credit_enabled'")) {
      return { rows: railEnabled ? [{ is_enabled: true }] : [{ is_enabled: false }] };
    }
    if (s.includes('FROM oxsteed_credit_rail_freezes')) return { rows: [] };
    // (a)/(c) The allowlist read.
    if (s.includes('FROM restaurant_credit_conversion_policy') && s.includes('WHERE restaurant_id = $1')) {
      return { rows: policyRow ? [policyRow] : [] };
    }
    // (f) The to_restaurant active-partner gate. Mirrors the food checkout
    // oxsteed_credit charge lookup exactly: only status = 'active' rows are
    // returned, so pending/missing rows both fail closed in the service.
    if (s.includes('FROM oxsteed_credit_partners') && s.includes("status = 'active'") && s.includes('LIMIT 1')) {
      return { rows: partnerRow && partnerRow.status === 'active' ? [{ id: partnerRow.id }] : [] };
    }
    // (a)/(c) Idempotency lookup for conversions.
    if (s.includes('FROM oxsteed_credit_restaurant_conversions WHERE idempotency_key = $1')) {
      return { rows: existingConversionRow ? [existingConversionRow] : [] };
    }
    // Central journal leg lookup after the wallet debit.
    if (s.includes('FROM oxsteed_credit_transactions') && s.includes('idempotency_key = $1')) {
      return { rows: [] };
    }
    // (a)/(c)/(f) The conversion INSERT. The direction is a SQL literal in
    // VALUES, so detect it from the statement text.
    if (s.includes('INSERT INTO oxsteed_credit_restaurant_conversions')) {
      return { rows: [conversionRowFromParams(params, s.includes("'to_restaurant'") ? 'to_restaurant' : 'from_restaurant')] };
    }
    // Audit events.
    if (s.includes('INSERT INTO oxsteed_credit_audit_events')) return { rows: [] };
    // (b) Pending actions.
    if (s.includes('INSERT INTO oxsteed_credit_pending_actions')) {
      return { rows: [pendingActionRow] };
    }
    if (s.includes('FROM oxsteed_credit_pending_actions WHERE id = $1 FOR UPDATE')) {
      return { rows: [{ ...pendingActionRow, status: pendingActionDecidedStatus }] };
    }
    if (s.includes('UPDATE oxsteed_credit_pending_actions')) {
      const status = s.includes("status = 'approved'") ? 'approved'
        : s.includes("status = 'rejected'") ? 'rejected'
        : s.includes("status = 'expired'") ? 'expired' : 'pending';
      pendingActionDecidedStatus = status;
      return { rows: [{ ...pendingActionRow, status, decided_by: CHECKER_ID, execution_refs: { policy: { restaurantId: RESTAURANT_ID } } }] };
    }
    if (s.includes('FROM oxsteed_credit_pending_actions WHERE id = $1')) {
      return { rows: [{ ...pendingActionRow, status: pendingActionDecidedStatus }] };
    }
    return { rows: [] };
  });
}

function resetPolicyState() {
  railEnabled = true;
  policyRow = null;
  partnerRow = null;
  existingConversionRow = null;
  pendingActionRow = null;
  pendingActionDecidedStatus = 'pending';
  debitFoodWallet.mockReset();
  debitFoodWallet.mockResolvedValue({ entry: { id: 'wallet-entry-1' } });
  creditFoodWallet.mockReset();
  creditFoodWallet.mockResolvedValue({ entry: { id: 'wallet-entry-2' } });
  postFoodWalletDualEntry.mockReset();
  postFoodWalletDualEntry.mockResolvedValue({ posted: true });
  policyService.upsertRestaurantConversionPolicy.mockReset();
  policyService.upsertRestaurantConversionPolicy.mockResolvedValue({
    restaurantId: RESTAURANT_ID, allowRestaurantToOxsteed: true,
    updatedAt: '2026-10-01T12:00:00.000Z', updatedByUserId: String(CHECKER_ID),
  });
  installRouter();
}

beforeEach(() => {
  resetMocks();
  resetPolicyState();
});

function conversionParams(overrides = {}) {
  return {
    customerId: CUSTOMER_ID,
    restaurantId: RESTAURANT_ID,
    amountCents: 5000,
    currencyCode: 'USD',
    idempotencyKey: 'k-conversion-1',
    ...overrides,
  };
}

// ── (a) The from_restaurant gate ────────────────────────────────────────
describe('from_restaurant conversion allowlist gate', () => {
  test('rejects with 403 credit_conversion_restaurant_not_enabled when no policy row exists', async () => {
    policyRow = null; // default-deny: no row at all

    await expect(convertRestaurantToOxsteed(conversionParams()))
      .rejects.toMatchObject({ statusCode: 403, code: 'credit_conversion_restaurant_not_enabled' });

    // No money moved: the wallet debit never ran and nothing was recorded.
    expect(debitFoodWallet).not.toHaveBeenCalled();
    const conversionInserts = mockQuery.mock.calls.filter(([sql]) =>
      String(sql).includes('INSERT INTO oxsteed_credit_restaurant_conversions'));
    expect(conversionInserts).toHaveLength(0);
  });

  test('rejects with 403 when the row exists but the flag is false', async () => {
    policyRow = { restaurant_id: RESTAURANT_ID, allow_restaurant_to_oxsteed: false };

    await expect(convertRestaurantToOxsteed(conversionParams()))
      .rejects.toMatchObject({ statusCode: 403, code: 'credit_conversion_restaurant_not_enabled' });
    expect(debitFoodWallet).not.toHaveBeenCalled();
  });

  test('succeeds when the row has allow_restaurant_to_oxsteed = true', async () => {
    policyRow = { restaurant_id: RESTAURANT_ID, allow_restaurant_to_oxsteed: true };

    const result = await convertRestaurantToOxsteed(conversionParams());

    expect(result.replayed).toBe(false);
    expect(result.conversion).toMatchObject({
      direction: 'from_restaurant',
      restaurantId: RESTAURANT_ID,
      sourceAmountCents: 5000,
      status: 'completed',
    });
    expect(debitFoodWallet).toHaveBeenCalledTimes(1);
    expect(debitFoodWallet).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      restaurantId: RESTAURANT_ID,
      customerId: CUSTOMER_ID,
      amountCents: 5000,
    }));
  });

  test('the rail kill switch still fires first (503 before the policy gate)', async () => {
    railEnabled = false;
    policyRow = null;

    await expect(convertRestaurantToOxsteed(conversionParams()))
      .rejects.toMatchObject({ statusCode: 503, code: 'credit_rail_suspended' });
    expect(debitFoodWallet).not.toHaveBeenCalled();
  });
});

// ── (f) The to_restaurant active-partner gate ───────────────────────────
describe('to_restaurant conversion active-partner gate', () => {
  test('rejects with 403 credit_conversion_restaurant_not_enabled when no partner row exists', async () => {
    partnerRow = null; // no row at all: fail closed

    await expect(convertOxsteedToRestaurant(conversionParams()))
      .rejects.toMatchObject({ statusCode: 403, code: 'credit_conversion_restaurant_not_enabled' });

    // No money moved: the restaurant wallet credit never ran (and so the
    // customer OxSteed wallet that funds the journal leg is untouched).
    expect(creditFoodWallet).not.toHaveBeenCalled();
    expect(postFoodWalletDualEntry).not.toHaveBeenCalled();
    const conversionInserts = mockQuery.mock.calls.filter(([sql]) =>
      String(sql).includes('INSERT INTO oxsteed_credit_restaurant_conversions'));
    expect(conversionInserts).toHaveLength(0);
  });

  test('a pending partner row does NOT satisfy the gate', async () => {
    // Auto-provisioning creates pending rows only; the admin status
    // transition is the only path to active, and pending must still deny.
    partnerRow = { id: 7, status: 'pending' };

    await expect(convertOxsteedToRestaurant(conversionParams()))
      .rejects.toMatchObject({ statusCode: 403, code: 'credit_conversion_restaurant_not_enabled' });
    expect(creditFoodWallet).not.toHaveBeenCalled();
    expect(postFoodWalletDualEntry).not.toHaveBeenCalled();
  });

  test('succeeds when an active partner row exists', async () => {
    partnerRow = { id: 7, status: 'active' };

    const result = await convertOxsteedToRestaurant(conversionParams());

    expect(result.replayed).toBe(false);
    expect(result.conversion).toMatchObject({
      direction: 'to_restaurant',
      restaurantId: RESTAURANT_ID,
      sourceAmountCents: 5000,
      status: 'completed',
    });
    expect(creditFoodWallet).toHaveBeenCalledTimes(1);
    expect(creditFoodWallet).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      restaurantId: RESTAURANT_ID,
      customerId: CUSTOMER_ID,
      amountCents: 5000,
    }));
    expect(postFoodWalletDualEntry).toHaveBeenCalledTimes(1);
  });

  test('the rail kill switch still fires first (503 before the partner gate)', async () => {
    railEnabled = false;
    partnerRow = null;

    await expect(convertOxsteedToRestaurant(conversionParams()))
      .rejects.toMatchObject({ statusCode: 503, code: 'credit_rail_suspended' });
    expect(creditFoodWallet).not.toHaveBeenCalled();
  });
});

// ── (c) Idempotency of the gate ─────────────────────────────────────────
describe('conversion idempotency with the gate', () => {
  test('replaying an already-executed conversion returns the stored result', async () => {
    policyRow = { restaurant_id: RESTAURANT_ID, allow_restaurant_to_oxsteed: true };

    const first = await convertRestaurantToOxsteed(conversionParams());
    expect(first.replayed).toBe(false);
    expect(debitFoodWallet).toHaveBeenCalledTimes(1);

    // Simulate the persisted row for the replay.
    existingConversionRow = conversionRowFromParams([
      'conv-1', CUSTOMER_ID, RESTAURANT_ID, 5000, 5000, 0, 'USD', '1',
      'wallet-entry-1', null, null, 'k-conversion-1', CUSTOMER_ID,
    ]);
    policyRow = null; // the restaurant is disabled AFTER the conversion ran

    const second = await convertRestaurantToOxsteed(conversionParams());
    // The existing replay contract is kept: the stored result is returned,
    // and the wallet debit does not run again.
    expect(second.replayed).toBe(true);
    expect(second.conversion).toMatchObject({ id: 'conv-1', direction: 'from_restaurant' });
    expect(debitFoodWallet).toHaveBeenCalledTimes(1);
  });

  test('a replay with different parameters still conflicts (409)', async () => {
    policyRow = { restaurant_id: RESTAURANT_ID, allow_restaurant_to_oxsteed: true };
    existingConversionRow = conversionRowFromParams([
      'conv-1', CUSTOMER_ID, RESTAURANT_ID, 5000, 5000, 0, 'USD', '1',
      'wallet-entry-1', null, null, 'k-conversion-1', CUSTOMER_ID,
    ]);

    await expect(convertRestaurantToOxsteed(conversionParams({ amountCents: 6000 })))
      .rejects.toMatchObject({ statusCode: 409, code: 'credit_conversion_idempotency_conflict' });
    expect(debitFoodWallet).not.toHaveBeenCalled();
  });
});

// ── (b) Maker-checker on the policy toggle ──────────────────────────────
describe('conversion policy maker-checker', () => {
  function conversionPolicyPendingRow() {
    pendingActionRow = {
      id: ACTION_ID,
      action_type: 'credit_restaurant_conversion_policy_update',
      payload: { restaurantId: RESTAURANT_ID, allowRestaurantToOxsteed: true, reason: 'Enable restaurant 42' },
      requested_by: MAKER_ID,
      requested_at: '2026-10-01T10:00:00.000Z',
      status: 'pending',
      decided_by: null,
      decided_at: null,
      decision_reason: null,
      expires_at: new Date(Date.now() + 3600 * 1000).toISOString(),
      idempotency_key: 'k-policy-1',
      execution_refs: {},
    };
    pendingActionDecidedStatus = 'pending';
  }

  beforeEach(() => { conversionPolicyPendingRow(); });

  test('requesting queues the toggle without executing it', async () => {
    const result = await requestPendingAction({
      actionType: 'credit_restaurant_conversion_policy_update',
      payload: { restaurantId: RESTAURANT_ID, allowRestaurantToOxsteed: true },
      requestedBy: MAKER_ID,
      idempotencyKey: 'k-policy-1',
    });
    expect(result.executed).toBe(false);
    expect(result.pendingAction.status).toBe('pending');
    expect(policyService.upsertRestaurantConversionPolicy).not.toHaveBeenCalled();
  });

  test('the maker cannot approve their own toggle (403)', async () => {
    await expect(decidePendingAction({
      actionId: ACTION_ID, decidedBy: MAKER_ID, decision: 'approve',
      stepupChallengeId: 'challenge-1', stepupCode: '123456',
    })).rejects.toMatchObject({ status: 403, code: 'credit_self_approval_forbidden' });
    expect(policyService.upsertRestaurantConversionPolicy).not.toHaveBeenCalled();
  });

  test('the checker executes exactly once; a second approval replays stored refs', async () => {
    const first = await decidePendingAction({
      actionId: ACTION_ID, decidedBy: CHECKER_ID, decision: 'approve',
      stepupChallengeId: 'challenge-1', stepupCode: '123456',
    });
    expect(first.replayed).toBe(false);
    expect(policyService.upsertRestaurantConversionPolicy).toHaveBeenCalledTimes(1);
    expect(policyService.upsertRestaurantConversionPolicy).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      restaurantId: RESTAURANT_ID,
      allowRestaurantToOxsteed: true,
    }));
    expect(first.pendingAction.status).toBe('approved');

    const second = await decidePendingAction({
      actionId: ACTION_ID, decidedBy: CHECKER_ID, decision: 'approve',
      stepupChallengeId: 'challenge-1', stepupCode: '123456',
    });
    expect(second.replayed).toBe(true);
    expect(policyService.upsertRestaurantConversionPolicy).toHaveBeenCalledTimes(1);
  });
});

// ── (d) Input validation ────────────────────────────────────────────────
describe('conversion policy input validation', () => {
  const { validateConversionPolicyInput } = policyService;

  test.each([
    ['non-numeric restaurant', { restaurantId: 'abc', allowRestaurantToOxsteed: true }, 'credit_conversion_policy_restaurant_invalid'],
    ['zero restaurant id', { restaurantId: 0, allowRestaurantToOxsteed: true }, 'credit_conversion_policy_restaurant_invalid'],
    ['missing restaurant', { allowRestaurantToOxsteed: true }, 'credit_conversion_policy_restaurant_invalid'],
    ['non-boolean flag', { restaurantId: 42, allowRestaurantToOxsteed: 'yes' }, 'credit_conversion_policy_flag_invalid'],
    ['missing flag', { restaurantId: 42 }, 'credit_conversion_policy_flag_invalid'],
  ])('rejects %s with 400 before anything is queued', (_label, input, code) => {
    expect(() => validateConversionPolicyInput(input)).toThrow(expect.objectContaining({ code, statusCode: 400 }));
  });

  test('accepts an enable toggle and normalizes the restaurant id', () => {
    expect(validateConversionPolicyInput({ restaurantId: '42', allowRestaurantToOxsteed: 'true' }))
      .toEqual({ restaurantId: 42, allowRestaurantToOxsteed: true });
    expect(validateConversionPolicyInput({ restaurantId: 42, allowRestaurantToOxsteed: false }))
      .toEqual({ restaurantId: 42, allowRestaurantToOxsteed: false });
  });
});

// ── (e) Migration 642 ───────────────────────────────────────────────────
describe('restaurant conversion policy migration (642)', () => {
  test('creates the allowlist table with default-deny semantics and no enabled seeds', () => {
    const migration = fs.readFileSync(
      path.join(__dirname, '..', 'migrations', '642_restaurant_conversion_policy.sql'),
      'utf8'
    );
    expect(migration).toContain('CREATE TABLE');
    expect(migration).toContain('restaurant_credit_conversion_policy');
    expect(migration).toContain('to_regclass');
    // Default-deny: the flag defaults to FALSE and nothing is seeded as enabled.
    expect(migration).toMatch(/allow_restaurant_to_oxsteed\s+BOOLEAN\s+NOT\s+NULL\s+DEFAULT\s+FALSE/);
    expect(migration).not.toMatch(/allow_restaurant_to_oxsteed\s*=\s*TRUE/i);
    expect(migration).not.toMatch(/INSERT INTO\s+restaurant_credit_conversion_policy/i);
  });
});
