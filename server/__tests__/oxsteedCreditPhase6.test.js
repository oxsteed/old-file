'use strict';

/**
 * Tests for OxSteed Credit Phase 6: money OUT and the fee schedule.
 *
 * Covers (Stripe is never hit; the DB is the suite's pg mock):
 *  - Fee schedule quotes: deterministic fixed+bps math, min/max clamps,
 *    env-override precedence, unknown operation types rejected.
 *  - Step-up: money-out action types registered; amount threshold shared
 *    across top-ups, withdrawals, transfers, and conversions.
 *  - Withdrawals: rail kill switch fails closed, tier-0 blocked, no connected
 *    account rejected, successful request stores the quoted fee, approval
 *    fails closed before Stripe when the rail is disabled.
 *  - Customer transfers: a sanctions hit on EITHER side blocks the transfer;
 *    the full success path posts both the transfer leg and the transfer_fee
 *    leg, and the posted fee equals the quote.
 *  - Restaurant conversion rate: defaults to 1, misconfiguration (>1 or
 *    non-positive) fails closed.
 */

const { mockQuery, resetMocks } = require('./setup');

jest.mock('../services/identityVerificationService', () => ({
  assertIdentityVerificationTier: jest.fn(),
}));
jest.mock('../services/sanctionsScreeningService', () => ({
  assertSanctionsClear: jest.fn(),
}));
jest.mock('../services/incidentStore', () => ({
  recordIncident: jest.fn(),
}));
jest.mock('../services/oxsteedCreditAdminService', () => ({
  insertAudit: jest.fn(),
}));

// Customer transfers are a deploy-time toggle; enable them for this suite
// before the credit service module is first required.
process.env.OXSTEED_CREDIT_ALLOW_CUSTOMER_TRANSFERS = 'true';

const { AppError } = require('../middleware/errorHandler');
const { quoteFee, listFeeSchedule } = require('../services/oxsteedCreditFeeScheduleService');
const stepupService = require('../services/stepupChallengeService');
const withdrawalService = require('../services/oxsteedCreditWithdrawalService');
const oxsteedCreditService = require('../services/oxsteedCreditService');
const identityService = require('../services/identityVerificationService');
const sanctionsService = require('../services/sanctionsScreeningService');

const CUSTOMER_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_CUSTOMER_ID = '33333333-3333-4333-8333-333333333333';
const ADMIN_ID = '99999999-9999-4999-8999-999999999999';

// One-shot ordered handlers plus repeating fallbacks keyed by SQL fragment.
function stubQueries(handlers, fallbacks = []) {
  const queue = handlers.map((h) => ({ ...h, used: false }));
  mockQuery.mockImplementation((sql) => {
    if (typeof sql === 'string') {
      const hit = queue.find((h) => !h.used
        && (typeof h.match === 'string' ? sql.includes(h.match) : h.match.test(sql)));
      if (hit) {
        hit.used = true;
        if (hit.fail) return Promise.reject(hit.fail);
        return Promise.resolve({ rows: hit.rows || [], rowCount: (hit.rows || []).length });
      }
      const fallback = fallbacks.find((f) => (typeof f.match === 'string' ? sql.includes(f.match) : f.match.test(sql)));
      if (fallback) {
        const rows = typeof fallback.rows === 'function' ? fallback.rows() : (fallback.rows || []);
        return Promise.resolve({ rows, rowCount: rows.length });
      }
    }
    return Promise.resolve({ rows: [], rowCount: 0 });
  });
}

const feeScheduleRow = (operationType, overrides = {}) => ({
  operation_type: operationType,
  fixed_cents: 25,
  percentage_bps: 100, // 1%
  min_fee_cents: 25,
  max_fee_cents: 500,
  effective_from: '2026-01-01T00:00:00.000Z',
  effective_to: null,
  ...overrides,
});

beforeEach(() => {
  resetMocks();
  jest.clearAllMocks();
  identityService.assertIdentityVerificationTier.mockResolvedValue({ allowed: true });
  sanctionsService.assertSanctionsClear.mockResolvedValue({ cleared: true });
  for (const key of Object.keys(process.env)) {
    if (key.startsWith('OXSTEED_CREDIT_FEE_')) delete process.env[key];
  }
});

describe('fee schedule quotes', () => {
  test('computes fixed + percentage with the min clamp', async () => {
    stubQueries([
      { match: 'FROM oxsteed_credit_fee_schedule', rows: [feeScheduleRow('withdrawal')] },
    ]);
    // 25 fixed + 1% of 5000 = 75
    const { feeCents } = await quoteFee({ operationType: 'withdrawal', currencyCode: 'USD', amountCents: 5000 });
    expect(feeCents).toBe(75);
  });

  test('min clamp applies on tiny amounts', async () => {
    stubQueries([
      { match: 'FROM oxsteed_credit_fee_schedule', rows: [feeScheduleRow('transfer', { fixed_cents: 0, percentage_bps: 50, min_fee_cents: 25 })] },
    ]);
    // 0.5% of 1000 = 5 -> clamped to 25
    const { feeCents } = await quoteFee({ operationType: 'transfer', currencyCode: 'USD', amountCents: 1000 });
    expect(feeCents).toBe(25);
  });

  test('max clamp applies on large amounts', async () => {
    stubQueries([
      { match: 'FROM oxsteed_credit_fee_schedule', rows: [feeScheduleRow('withdrawal')] },
    ]);
    // 25 + 1% of 200000 = 2025 -> clamped to 500
    const { feeCents } = await quoteFee({ operationType: 'withdrawal', currencyCode: 'USD', amountCents: 200000 });
    expect(feeCents).toBe(500);
  });

  test('env overrides take precedence over the DB schedule', async () => {
    process.env.OXSTEED_CREDIT_FEE_WITHDRAWAL_FIXED_CENTS = '100';
    process.env.OXSTEED_CREDIT_FEE_WITHDRAWAL_BPS = '0';
    process.env.OXSTEED_CREDIT_FEE_WITHDRAWAL_MIN_CENTS = '0';
    stubQueries([
      // If the DB row were read instead of the env override this would be 75.
      { match: 'FROM oxsteed_credit_fee_schedule', rows: [feeScheduleRow('withdrawal')] },
    ]);
    const { feeCents, source } = await quoteFee({ operationType: 'withdrawal', currencyCode: 'USD', amountCents: 5000 });
    expect(feeCents).toBe(100);
    expect(source).toBe('env');
  });

  test('unknown operation type is rejected', async () => {
    await expect(quoteFee({ operationType: 'teleport', currencyCode: 'USD', amountCents: 100 }))
      .rejects.toMatchObject({ code: 'credit_fee_operation_invalid' });
  });

  test('no schedule row means a zero fee', async () => {
    stubQueries([{ match: 'FROM oxsteed_credit_fee_schedule', rows: [] }]);
    const { feeCents } = await quoteFee({ operationType: 'top_up', currencyCode: 'USD', amountCents: 5000 });
    expect(feeCents).toBe(0);
  });
});

describe('step-up money-out coverage', () => {
  test('registers withdrawal, customer_transfer, and restaurant_conversion action types', () => {
    expect(stepupService.STEPUP_ACTION_TYPES).toEqual(
      expect.arrayContaining(['withdrawal', 'customer_transfer', 'restaurant_conversion'])
    );
  });

  test('the same amount threshold applies to money-out operations', () => {
    expect(stepupService.amountRequiresStepup(stepupService.STEPUP_THRESHOLD_CENTS)).toBe(true);
    expect(stepupService.amountRequiresStepup(stepupService.STEPUP_THRESHOLD_CENTS - 1)).toBe(false);
  });
});

describe('withdrawal request guards', () => {
  test('fails closed when the credit rail is disabled', async () => {
    stubQueries([{ match: 'FROM feature_flags', rows: [{ is_enabled: false }] }]);
    await expect(withdrawalService.requestWithdrawal({
      customerId: CUSTOMER_ID, amountCents: 5000, currencyCode: 'USD', idempotencyKey: 'idem-w1',
    })).rejects.toMatchObject({ code: 'credit_rail_suspended', status: 503 });
  });

  test('tier-0 customers cannot withdraw', async () => {
    identityService.assertIdentityVerificationTier.mockRejectedValueOnce(
      new AppError('Identity verification is required before fiat withdrawals', 403, 'credit_identity_verification_required')
    );
    stubQueries([{ match: 'FROM feature_flags', rows: [{ is_enabled: true }] }]);
    await expect(withdrawalService.requestWithdrawal({
      customerId: CUSTOMER_ID, amountCents: 5000, currencyCode: 'USD', idempotencyKey: 'idem-w2',
    })).rejects.toMatchObject({ code: 'credit_identity_verification_required' });
  });

  test('a sanctions hit blocks the request', async () => {
    sanctionsService.assertSanctionsClear.mockRejectedValueOnce(
      new AppError('Sanctions screening failed', 403, 'credit_sanctions_blocked')
    );
    stubQueries([{ match: 'FROM feature_flags', rows: [{ is_enabled: true }] }]);
    await expect(withdrawalService.requestWithdrawal({
      customerId: CUSTOMER_ID, amountCents: 5000, currencyCode: 'USD', idempotencyKey: 'idem-w3',
    })).rejects.toMatchObject({ code: 'credit_sanctions_blocked' });
  });

  test('no connected payout destination is rejected', async () => {
    stubQueries([
      { match: 'FROM feature_flags', rows: [{ is_enabled: true }] },
      { match: 'FROM connect_accounts', rows: [] },
    ]);
    await expect(withdrawalService.requestWithdrawal({
      customerId: CUSTOMER_ID, amountCents: 5000, currencyCode: 'USD', idempotencyKey: 'idem-w4',
    })).rejects.toMatchObject({ code: 'credit_withdrawal_no_connected_account', status: 409 });
  });

  test('a successful request stores the quoted fee and the net amount', async () => {
    const requestedAt = '2026-10-01T14:00:00.000Z';
    const inserted = {
      id: 'wd-1', customer_id: CUSTOMER_ID, amount_cents: 5000, fee_cents: 75,
      net_cents: 4925, currency_code: 'USD', status: 'requested',
      destination_account_ref: 'acct_1', idempotency_key: 'idem-w5',
      created_at: requestedAt, updated_at: requestedAt,
    };
    stubQueries([
      { match: 'FROM feature_flags', rows: [{ is_enabled: true }] },
      { match: 'FROM connect_accounts', rows: [{ stripe_account_id: 'acct_1' }] },
      { match: 'FROM oxsteed_credit_withdrawals', rows: [{ day_total: '0' }] },
      { match: 'FROM oxsteed_credit_fee_schedule', rows: [feeScheduleRow('withdrawal')] },
      { match: 'INSERT INTO oxsteed_credit_withdrawals', rows: [inserted] },
      // Phase 7 (gap 11): the request reserves the gross amount on the wallet.
      { match: 'SELECT a.* FROM oxsteed_credit_accounts', rows: [{ id: 11, account_type: 'customer_wallet', customer_id: CUSTOMER_ID, balance_cents: 100000, reserved_cents: 0, status: 'active', currency_code: 'USD' }] },
      { match: 'SELECT id, balance_cents, reserved_cents, status', rows: [{ id: 11, balance_cents: 100000, reserved_cents: 0, status: 'active' }] },
      { match: 'INSERT INTO oxsteed_credit_reservations', rows: [{ id: 'res-w1', account_id: 11, status: 'active' }] },
    ]);
    const { withdrawal, replayed } = await withdrawalService.requestWithdrawal({
      customerId: CUSTOMER_ID, amountCents: 5000, currencyCode: 'USD', idempotencyKey: 'idem-w5',
    });
    expect(replayed).toBe(false);
    expect(withdrawal.feeCents).toBe(75);
    expect(withdrawal.netCents).toBe(4925);
    expect(withdrawal.status).toBe('requested');
  });
});

describe('withdrawal approval', () => {
  test('fails closed before Stripe when the rail is disabled', async () => {
    const getStripe = jest.fn();
    const row = {
      id: 'wd-2', customer_id: CUSTOMER_ID, amount_cents: 5000, fee_cents: 75,
      net_cents: 4925, currency_code: 'USD', status: 'requested',
      expires_at: new Date(Date.now() + 3600_000).toISOString(),
    };
    stubQueries([
      { match: /FROM oxsteed_credit_withdrawals WHERE id/, rows: [row] },
      { match: 'FROM feature_flags', rows: [{ is_enabled: false }] },
    ]);
    await expect(withdrawalService.approveWithdrawal({
      withdrawalId: 'wd-2', actorUserId: ADMIN_ID, idempotencyKey: 'idem-a1', getStripe,
    })).rejects.toMatchObject({ code: 'credit_rail_suspended', status: 503 });
    expect(getStripe).not.toHaveBeenCalled();
  });
});

describe('customer transfers', () => {
  test('a sanctions hit on the RECIPIENT blocks the transfer', async () => {
    sanctionsService.assertSanctionsClear
      .mockResolvedValueOnce({ cleared: true }) // sender clear
      .mockRejectedValueOnce(new AppError('Recipient sanctions hit', 403, 'credit_sanctions_blocked'));
    stubQueries([
      { match: 'FROM feature_flags', rows: [{ is_enabled: true }] },
      { match: 'SELECT pg_advisory_xact_lock', rows: [] },
      { match: 'FROM users WHERE id', rows: [{ id: OTHER_CUSTOMER_ID }] },
    ]);
    await expect(oxsteedCreditService.transferCredit({
      senderCustomerId: CUSTOMER_ID,
      recipientCustomerId: OTHER_CUSTOMER_ID,
      amountCents: 5000,
      currencyCode: 'USD',
      idempotencyKey: 'idem-t1',
      actorUserId: CUSTOMER_ID,
    })).rejects.toMatchObject({ code: 'credit_sanctions_blocked' });
    expect(mockQuery).not.toHaveBeenCalledWith(expect.stringContaining('INSERT INTO oxsteed_credit_transactions'), expect.anything());
  });

  test('the success path posts a transfer leg and a transfer_fee leg with the quoted fee', async () => {
    const senderWallet = { id: 11, account_type: 'customer_wallet', customer_id: CUSTOMER_ID, currency_code: 'USD', balance_cents: 10000, reserved_cents: 0, status: 'active', ledger_version: 1, last_entry_hash: 'h1' };
    const recipientWallet = { id: 12, account_type: 'customer_wallet', customer_id: OTHER_CUSTOMER_ID, currency_code: 'USD', balance_cents: 100, reserved_cents: 0, status: 'active', ledger_version: 1, last_entry_hash: 'h2' };
    const revenue = { id: 13, account_type: 'platform_revenue', currency_code: 'USD', balance_cents: 0, reserved_cents: 0, status: 'active', ledger_version: 1, last_entry_hash: 'h3' };

    let lockCall = 0;
    let insertCall = 0;
    const postedTypes = [];
    stubQueries([
      { match: 'FROM feature_flags', rows: [{ is_enabled: true }] },
      { match: 'SELECT pg_advisory_xact_lock', rows: [] },
      { match: 'FROM users WHERE id', rows: [{ id: OTHER_CUSTOMER_ID }] },
      { match: 'WITH lock AS', rows: [{ transfer_count: 0, total_cents: '0' }] },
      { match: 'FROM oxsteed_credit_fee_schedule', rows: [feeScheduleRow('transfer')] },
    ], [
      { match: 'INSERT INTO oxsteed_credit_accounts', rows: [] },
      {
        match: 'INSERT INTO oxsteed_credit_transaction_entries',
        rows: () => [{ id: 9001, account_id: 11, entry_side: 'debit', amount_cents: 5000 }],
      },
      {
        match: 'SELECT a.* FROM oxsteed_credit_accounts',
        rows: () => {
          lockCall += 1;
          // ensureAccount sender, ensureAccount recipient, ensureAccount revenue
          if (lockCall === 1) return [senderWallet];
          if (lockCall === 2) return [recipientWallet];
          return [revenue];
        },
      },
      {
        match: 'SELECT * FROM oxsteed_credit_accounts',
        rows: () => {
          // postJournalTransaction account lock: 1st = transfer, 2nd = fee
          insertCall += 1;
          if (insertCall === 1) return [senderWallet, recipientWallet];
          return [senderWallet, revenue];
        },
      },
    ]);

    // Intercept the transaction INSERT to capture posted types and amounts.
    mockQuery.mockImplementation(((prev) => (sql, params) => {
      if (typeof sql === 'string' && sql.includes('INSERT INTO oxsteed_credit_transactions')) {
        postedTypes.push({ type: params[0], amount: params[3] });
        return Promise.resolve({ rows: [{ id: `tx-${postedTypes.length}`, transaction_type: params[0], amount_cents: params[3], status: 'posted', currency_code: 'USD' }], rowCount: 1 });
      }
      return prev(sql, params);
    })(mockQuery.getMockImplementation()));

    const result = await oxsteedCreditService.transferCredit({
      senderCustomerId: CUSTOMER_ID,
      recipientCustomerId: OTHER_CUSTOMER_ID,
      amountCents: 5000,
      currencyCode: 'USD',
      idempotencyKey: 'idem-t2',
      actorUserId: CUSTOMER_ID,
    });

    // fee = 25 + 1% of 5000 = 75; sender had 10000, enough for both legs.
    expect(result.feeCents).toBe(75);
    expect(result.feeTransactionId).toBe('tx-2');
    expect(postedTypes).toEqual([
      { type: 'transfer', amount: 5000 },
      { type: 'transfer_fee', amount: 75 },
    ]);
  });
});

describe('restaurant conversion rate guard', () => {
  const { getConversionRate } = require('../services/oxsteedCreditRestaurantConversionService');

  test('a misconfigured rate above 1 fails closed', () => {
    process.env.OXSTEED_CREDIT_RESTAURANT_CONVERSION_RATE = '1.5';
    expect(() => getConversionRate()).toThrow(expect.objectContaining({
      code: 'credit_conversion_rate_unavailable',
      status: 503,
    }));
    delete process.env.OXSTEED_CREDIT_RESTAURANT_CONVERSION_RATE;
  });

  test('a non-positive rate fails closed', () => {
    process.env.OXSTEED_CREDIT_RESTAURANT_CONVERSION_RATE = '0';
    expect(() => getConversionRate()).toThrow(expect.objectContaining({
      code: 'credit_conversion_rate_unavailable',
      status: 503,
    }));
    delete process.env.OXSTEED_CREDIT_RESTAURANT_CONVERSION_RATE;
  });

  test('the default rate is 1:1', () => {
    expect(getConversionRate()).toBe(1);
  });
});
