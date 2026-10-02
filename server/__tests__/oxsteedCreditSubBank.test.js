'use strict';

/**
 * Phase 1 central-bank model tests: restaurant sub-bank accounts (migration 632)
 * and the dual-posting path from the food-wallet ledger.
 *
 * Mock strategy follows the house pattern (server/__tests__/setup.js mocks pg):
 * a scripted mockQuery answers per-SQL-fragment with fixture rows, keeping the
 * whole dual-post flow (rail check, partner provisioning, ensureAccount,
 * postJournalTransaction) deterministic without a live database.
 */

const path = require('path');
const fs = require('fs');

jest.mock('../services/reconciliationExceptions', () => ({
  recordException: jest.fn(async () => null),
}));

const {
  SUB_BANK_ACCOUNT_TYPE,
  SUB_BANK_LOAD,
  SUB_BANK_REDEMPTION,
  SUB_BANK_REFUND,
  SUB_BANK_OPENING_BALANCE,
  resolveDualPostingAction,
  postFoodWalletDualEntry,
} = require('../services/oxsteedCreditSubBankService');
const { applyWalletLedgerEntry } = require('../services/foodWalletService');
const { withTransaction } = require('../utils/transaction');

const MIGRATION_SQL = fs.readFileSync(
  path.join(__dirname, '..', 'migrations', '632_oxsteed_credit_restaurant_sub_banks.sql'),
  'utf8'
);

const RESTAURANT_ID = 9;
const CUSTOMER_ID = 'cust-1';
const CURRENCY = 'USD';

function makeAccount({ id, accountType, restaurantId = null, partnerId = null, balanceCents = 0 }) {
  return {
    id,
    account_type: accountType,
    customer_id: null,
    partner_id: partnerId,
    restaurant_id: restaurantId,
    currency_code: CURRENCY,
    balance_cents: balanceCents,
    reserved_cents: 0,
    status: 'active',
    ledger_version: 0,
    last_entry_hash: null,
  };
}

/**
 * Build a mock query function that walks the real SQL sequence of
 * postFoodWalletDualEntry + postJournalTransaction and returns fixture rows.
 */
function makeDualPostMock({ railEnabled = true, existingPartner = null, failOn = null } = {}) {
  const subBank = makeAccount({ id: 100, accountType: SUB_BANK_ACCOUNT_TYPE, restaurantId: RESTAURANT_ID, balanceCents: 5000 });
  const treasury = makeAccount({ id: 200, accountType: 'platform_treasury', balanceCents: 1000000 });
  const payable = makeAccount({ id: 300, accountType: 'partner_payable', partnerId: 41, balanceCents: 0 });
  const issued = [];
  const backfilled = [];

  const mockQuery = jest.fn(async (text, params = []) => {
    const sql = String(text);
    if (failOn && sql.includes(failOn)) throw new Error(`scripted failure at ${failOn}`);
    if (sql.includes('pg_advisory_xact_lock(hashtext')) return { rows: [{}] };
    if (sql.includes("FROM feature_flags WHERE key = 'oxsteed_credit_enabled'")) {
      return railEnabled ? { rows: [{ is_enabled: true }] } : { rows: [{ is_enabled: false }] };
    }
    if (sql.includes('FROM oxsteed_credit_partners p WHERE p.restaurant_id')) {
      return { rows: existingPartner ? [existingPartner] : [] };
    }
    if (sql.includes('FROM food_restaurants WHERE id')) {
      return { rows: [{ id: RESTAURANT_ID, business_id: 5 }] };
    }
    if (sql.includes('INSERT INTO oxsteed_credit_partners')) {
      return { rows: [{ id: 41, restaurant_id: RESTAURANT_ID, business_id: 5, settlement_currency_code: 'USD', status: 'pending' }] };
    }
    if (sql.includes('INSERT INTO oxsteed_credit_accounts')) return { rows: [] };
    if (sql.includes('FROM oxsteed_credit_accounts a')) {
      const accountType = params[0];
      if (accountType === SUB_BANK_ACCOUNT_TYPE) return { rows: [subBank] };
      if (accountType === 'platform_treasury') return { rows: [treasury] };
      if (accountType === 'partner_payable') return { rows: [payable] };
      return { rows: [] };
    }
    if (sql.includes('SELECT * FROM oxsteed_credit_transactions WHERE idempotency_key')) {
      return { rows: [] };
    }
    if (sql.includes('SELECT id, status, transaction_type FROM oxsteed_credit_transactions')) {
      return { rows: [] };
    }
    if (sql.includes('WHERE id = ANY($1::bigint[])')) {
      const requestedIds = new Set((params[0] || []).map(String));
      const all = [subBank, treasury, payable].filter((account) => requestedIds.has(String(account.id)));
      return { rows: all.sort((a, b) => a.id - b.id) };
    }
    if (sql.includes('INSERT INTO credit_dual_posting_backfill')) {
      const seen = new Set(backfilled.map((r) => r.idempotency_key));
      if (!seen.has(params[0])) {
        backfilled.push({
          idempotency_key: params[0],
          ledger_entry_id: params[1],
          restaurant_id: params[2],
          customer_id: params[3],
          currency_code: params[4],
          amount_cents: params[5],
          entry_type: params[6],
          reference_type: params[7],
          reference_id: params[8],
          actor_type: params[9],
          actor_user_id: params[10],
          created_by_user_id: params[11],
          correlation_id: params[12],
          request_ip: params[13],
          metadata: JSON.parse(params[14] || '{}'),
          status: 'pending',
          attempts: 0,
        });
      }
      return { rows: [], rowCount: 1 };
    }
    if (sql.includes('INSERT INTO oxsteed_credit_transactions')) {
      const row = {
        id: 5000 + issued.length,
        transaction_type: params[0],
        debit_account_id: params[1],
        credit_account_id: params[2],
        amount_cents: params[3],
        currency_code: params[4],
        partner_id: params[5],
        agreement_id: params[6],
        idempotency_key: params[7],
        reference_type: params[8],
        reference_id: params[9],
        reason: params[10],
        description: params[11],
        actor_type: params[12],
        actor_user_id: params[13],
        metadata: params[14],
        status: 'posted',
        posted_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
      };
      issued.push(row);
      return { rows: [row] };
    }
    if (sql.includes('WITH ledger_write AS')) return { rows: [makeAccount({ id: params[4] || 0, accountType: 'platform_treasury' })] };
    if (sql.includes('INSERT INTO oxsteed_credit_transaction_entries')) return { rows: [{ id: 9000 + issued.length }] };
    if (sql.includes('INSERT INTO oxsteed_credit_audit_events')) return { rows: [] };
    if (sql.includes('oxsteed_credit_notifications')) return { rows: [] };
    return { rows: [], rowCount: 0 };
  });
  return { mockQuery, issued, backfilled, subBank, treasury, payable };
}

function makeDualPostInput(overrides = {}) {
  return {
    ledgerEntryId: 7001,
    restaurantId: RESTAURANT_ID,
    customerId: CUSTOMER_ID,
    currencyCode: CURRENCY,
    amountCents: 500,
    entryType: 'credit',
    referenceType: 'merchant_load',
    referenceId: 'load-1',
    actorType: 'system',
    actorUserId: null,
    createdByUserId: null,
    correlationId: 'corr-1',
    requestIp: '127.0.0.1',
    metadata: {},
    ...overrides,
  };
}

describe('restaurant sub-bank migration 632 (static)', () => {
  test('adds restaurant_sub_bank to the account_type CHECK', () => {
    expect(MIGRATION_SQL).toMatch(/CHECK\s*\(\s*account_type IN\s*\([\s\S]*restaurant_sub_bank/);
  });

  test('adds the nullable restaurant_id column with an FK to food_restaurants', () => {
    expect(MIGRATION_SQL).toContain('ADD COLUMN IF NOT EXISTS restaurant_id BIGINT');
    expect(MIGRATION_SQL).toContain('REFERENCES food_restaurants(id)');
  });

  test('guards owner linkage: sub-bank requires restaurant_id, other types forbid it', () => {
    expect(MIGRATION_SQL).toContain("account_type = 'restaurant_sub_bank' AND restaurant_id IS NOT NULL AND customer_id IS NULL AND partner_id IS NULL");
    expect(MIGRATION_SQL).toContain("AND partner_id IS NOT NULL AND restaurant_id IS NULL");
    expect(MIGRATION_SQL).toContain("AND partner_id IS NULL AND restaurant_id IS NULL");
  });

  test('one sub-bank account per restaurant and currency', () => {
    expect(MIGRATION_SQL).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS uq_oxsteed_credit_restaurant_sub_bank/);
    expect(MIGRATION_SQL).toMatch(/WHERE account_type = 'restaurant_sub_bank'/);
  });

  test('adds the four sub-bank transaction types to the transaction_type CHECK', () => {
    for (const type of [SUB_BANK_LOAD, SUB_BANK_REDEMPTION, SUB_BANK_REFUND, SUB_BANK_OPENING_BALANCE]) {
      expect(MIGRATION_SQL).toContain(`'${type}'`);
    }
  });

  test('does NOT exempt sub-banks from the non-negative balance floor', () => {
    expect(MIGRATION_SQL).not.toMatch(/oxsteed_credit_accounts_balance_owner_check/);
    expect(MIGRATION_SQL).not.toMatch(/balance_cents >= 0/);
  });

  test('trigger validator function is recreated with sub-bank branches', () => {
    expect(MIGRATION_SQL).toContain('CREATE OR REPLACE FUNCTION validate_oxsteed_credit_transaction_types');
    for (const type of [SUB_BANK_LOAD, SUB_BANK_REDEMPTION, SUB_BANK_REFUND, SUB_BANK_OPENING_BALANCE]) {
      expect(MIGRATION_SQL).toContain(`ELSIF NEW.transaction_type = '${type}' THEN`);
    }
    expect(MIGRATION_SQL).toContain('OxSteed Credit transaction account direction is invalid for its type');
  });
});

describe('resolveDualPostingAction', () => {
  test.each([
    ['credit', 'merchant_load', 'load'],
    ['credit', 'merchant_load_request', 'load'],
    ['debit', 'food_order', 'redemption'],
    ['debit', 'wallet_hold', 'redemption'],
    ['debit', 'wallet_payment_session', 'redemption'],
    ['refund', 'food_order', 'refund'],
    ['refund', 'food_order_refund', 'refund'],
    ['debit', 'wallet_transfer_out', 'skip_transfer'],
    ['credit', 'wallet_transfer_in', 'skip_transfer'],
  ])('%s / %s resolves to %s', (entryType, referenceType, expected) => {
    expect(resolveDualPostingAction(entryType, referenceType)).toBe(expected);
  });

  test('throws for an unmapped money-moving reference type (fail closed)', () => {
    expect(() => resolveDualPostingAction('credit', 'future_reference_type')).toThrow(
      expect.objectContaining({ code: 'food_wallet_dual_posting_unmapped' })
    );
  });
});

describe('postFoodWalletDualEntry', () => {
  test('load posts a balanced sub_bank_load pair: treasury -> sub-bank', async () => {
    const { mockQuery, issued } = makeDualPostMock();
    const result = await postFoodWalletDualEntry({ query: mockQuery }, makeDualPostInput());
    expect(result.posted).toBe(true);
    expect(result.replayed).toBe(false);
    expect(issued).toHaveLength(1);
    const txn = issued[0];
    expect(txn.transaction_type).toBe(SUB_BANK_LOAD);
    expect(txn.debit_account_id).toBe(200);
    expect(txn.credit_account_id).toBe(100);
    expect(txn.amount_cents).toBe(500);
    expect(txn.idempotency_key).toBe('food-wallet-ledger:7001:central');
    expect(txn.status).toBe('posted');
  });

  test('load auto-provisions the partner row on first activity', async () => {
    const { mockQuery } = makeDualPostMock({ existingPartner: null });
    await postFoodWalletDualEntry({ query: mockQuery }, makeDualPostInput());
    const partnerInsert = mockQuery.mock.calls.find(([sql]) => sql.includes('INSERT INTO oxsteed_credit_partners'));
    expect(partnerInsert).toBeTruthy();
    expect(partnerInsert[1][0]).toBe(RESTAURANT_ID);
  });

  test('load skips the partner insert when the partner already exists', async () => {
    const { mockQuery } = makeDualPostMock({ existingPartner: { id: 41, restaurant_id: RESTAURANT_ID } });
    await postFoodWalletDualEntry({ query: mockQuery }, makeDualPostInput());
    const partnerInsert = mockQuery.mock.calls.find(([sql]) => sql.includes('INSERT INTO oxsteed_credit_partners'));
    expect(partnerInsert).toBeUndefined();
  });

  test('redemption posts sub_bank_redemption: sub-bank -> partner_payable', async () => {
    const { mockQuery, issued } = makeDualPostMock();
    await postFoodWalletDualEntry(
      { query: mockQuery },
      makeDualPostInput({ ledgerEntryId: 7002, entryType: 'debit', referenceType: 'food_order', referenceId: 'order-9' })
    );
    expect(issued).toHaveLength(1);
    expect(issued[0].transaction_type).toBe(SUB_BANK_REDEMPTION);
    expect(issued[0].debit_account_id).toBe(100);
    expect(issued[0].credit_account_id).toBe(300);
    expect(issued[0].partner_id).toBe(41);
  });

  test('refund posts sub_bank_refund: partner_payable -> sub-bank', async () => {
    const { mockQuery, issued } = makeDualPostMock();
    await postFoodWalletDualEntry(
      { query: mockQuery },
      makeDualPostInput({ ledgerEntryId: 7003, entryType: 'refund', referenceType: 'food_order_refund', referenceId: 'refund-2', metadata: { originalDebitEntryId: 7002 } })
    );
    expect(issued).toHaveLength(1);
    expect(issued[0].transaction_type).toBe(SUB_BANK_REFUND);
    expect(issued[0].debit_account_id).toBe(300);
    expect(issued[0].credit_account_id).toBe(100);
  });

  test('same-restaurant transfer skips the central posting (aggregate unchanged)', async () => {
    const { mockQuery, issued } = makeDualPostMock();
    const result = await postFoodWalletDualEntry(
      { query: mockQuery },
      makeDualPostInput({ ledgerEntryId: 7004, entryType: 'debit', referenceType: 'wallet_transfer_out' })
    );
    expect(result.posted).toBe(false);
    expect(result.skipped).toBe('transfer_aggregate_unchanged');
    expect(issued).toHaveLength(0);
    expect(mockQuery.mock.calls.some(([sql]) => sql.includes('INSERT INTO oxsteed_credit_transactions'))).toBe(false);
  });

  test('disabled credit rail fails OPEN: wallet write proceeds, dual-post queued for backfill', async () => {
    const { mockQuery, issued, backfilled } = makeDualPostMock({ railEnabled: false });
    const result = await postFoodWalletDualEntry({ query: mockQuery }, makeDualPostInput());
    expect(result.posted).toBe(false);
    expect(result.backfilled).toBe(true);
    expect(result.reason).toBe('credit_rail_suspended');
    expect(issued).toHaveLength(0);
    expect(backfilled).toHaveLength(1);
    expect(backfilled[0]).toMatchObject({
      ledger_entry_id: '7001',
      restaurant_id: String(RESTAURANT_ID),
      currency_code: CURRENCY,
      amount_cents: 500,
      entry_type: 'credit',
      reference_type: 'merchant_load',
      status: 'pending',
    });
    expect(backfilled[0].idempotency_key).toBe('food-wallet-ledger:7001:central');
    // No account provisioning or journal work happens on the fail-open path.
    expect(mockQuery.mock.calls.some(([sql]) => sql.includes('FROM oxsteed_credit_partners'))).toBe(false);
  });

  test('backfill queueing is idempotent on the deterministic dual-posting key', async () => {
    const { mockQuery, backfilled } = makeDualPostMock({ railEnabled: false });
    const input = makeDualPostInput();
    await postFoodWalletDualEntry({ query: mockQuery }, input);
    await postFoodWalletDualEntry({ query: mockQuery }, input);
    expect(backfilled).toHaveLength(1);
  });

  test('unmapped reference type throws and never touches the rail', async () => {
    const { mockQuery, issued } = makeDualPostMock();
    await expect(postFoodWalletDualEntry(
      { query: mockQuery },
      makeDualPostInput({ referenceType: 'brand_new_reference' })
    )).rejects.toMatchObject({ code: 'food_wallet_dual_posting_unmapped' });
    expect(issued).toHaveLength(0);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test('idempotent replay of the same ledger entry resolves without re-posting', async () => {
    const first = makeDualPostMock();
    const winnerMetadata = {
      foodWalletLedgerEntryId: 7001,
      foodWalletEntryType: 'credit',
      foodWalletReferenceType: 'merchant_load',
      foodWalletReferenceId: 'load-1',
      restaurantId: RESTAURANT_ID,
    };
    const winner = {
      id: 5000,
      transaction_type: SUB_BANK_LOAD,
      debit_account_id: 200,
      credit_account_id: 100,
      amount_cents: 500,
      currency_code: CURRENCY,
      partner_id: 41,
      agreement_id: null,
      idempotency_key: 'food-wallet-ledger:7001:central',
      reference_type: 'food_wallet_ledger',
      reference_id: '7001',
      reason: 'Restaurant credit dual-posting to the central journal',
      description: 'Restaurant credit issuance dual-posting (wallet ledger entry 7001)',
      actor_type: 'system',
      metadata: winnerMetadata,
      status: 'posted',
      posted_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
    };
    const replayMock = jest.fn(async (text, params = []) => {
      const sql = String(text);
      if (sql.includes('SELECT * FROM oxsteed_credit_transactions WHERE idempotency_key')) {
        return { rows: [winner] };
      }
      if (sql.includes('FROM oxsteed_credit_transaction_entries WHERE transaction_id')) {
        return { rows: [] };
      }
      return first.mockQuery(text, params);
    });
    const result = await postFoodWalletDualEntry({ query: replayMock }, makeDualPostInput());
    expect(result.posted).toBe(true);
    expect(result.replayed).toBe(true);
    expect(result.transaction.id).toBe('5000');
    expect(replayMock.mock.calls.some(([sql]) => sql.includes('INSERT INTO oxsteed_credit_transactions'))).toBe(false);
  });

  test('invalid restaurant id is rejected', async () => {
    const { mockQuery } = makeDualPostMock();
    await expect(postFoodWalletDualEntry(
      { query: mockQuery },
      makeDualPostInput({ restaurantId: -3 })
    )).rejects.toMatchObject({ code: 'sub_bank_restaurant_invalid' });
  });
});

describe('dual-posting atomicity with the food-wallet write', () => {
  function makeWalletClient({ failOn = null, railEnabled = true } = {}) {
    const account = {
      id: 11, restaurant_id: RESTAURANT_ID, customer_id: CUSTOMER_ID,
      currency_code: CURRENCY, balance_cents: 1000, reserved_cents: 0,
      status: 'active', ledger_version: 0, last_entry_hash: null,
    };
    const ledgerEntry = { id: 7001 };
    const dual = makeDualPostMock({ failOn, railEnabled });
    const query = jest.fn(async (text, params = []) => {
      const sql = String(text);
      if (sql.includes('INSERT INTO food_customer_wallet_accounts')) return { rows: [] };
      if (sql.includes('FROM food_customer_wallet_accounts a')) return { rows: [account] };
      if (sql.includes('FROM food_customer_wallet_ledger')) return { rows: [] };
      if (sql.includes('UPDATE food_customer_wallet_accounts')) {
        return { rows: [{ ...account, balance_cents: 1500, ledger_version: 1 }] };
      }
      if (sql.includes('INSERT INTO food_customer_wallet_ledger')) return { rows: [ledgerEntry] };
      return dual.mockQuery(text, params);
    });
    return { query, account, dual };
  }

  test('applyWalletLedgerEntry dual-posts merchant_load in the same client', async () => {
    const { query, dual } = makeWalletClient();
    const result = await applyWalletLedgerEntry({ query }, {
      restaurantId: RESTAURANT_ID,
      customerId: CUSTOMER_ID,
      currencyCode: CURRENCY,
      entryType: 'credit',
      amountCents: 500,
      referenceType: 'merchant_load',
      referenceId: 'load-1',
      idempotencyKey: 'wallet-load-1',
    });
    expect(result.replayed).toBe(false);
    expect(result.entry.id).toBe(7001);
    expect(dual.issued).toHaveLength(1);
    expect(dual.issued[0].transaction_type).toBe(SUB_BANK_LOAD);
    expect(dual.issued[0].idempotency_key).toBe('food-wallet-ledger:7001:central');
  });

  test('a failed central posting rejects, so the caller rolls back the wallet write', async () => {
    // NOTE: __tests__/setup.js replaces withTransaction with a pass-through
    // (no real BEGIN/COMMIT), so this test proves the failure propagates out
    // of applyWalletLedgerEntry and that the failing journal insert happens
    // AFTER the wallet ledger insert in the same client call sequence. In
    // production the caller shares one real transaction, so this same
    // rejection path triggers its ROLLBACK and the wallet write never commits.
    const { query } = makeWalletClient({ failOn: 'INSERT INTO oxsteed_credit_transactions' });
    const order = [];
    const fakePool = {
      query: async (text, params) => {
        order.push(String(text).split('\n')[0].trim());
        return query(text, params);
      },
    };
    await expect(withTransaction(fakePool, (client) => applyWalletLedgerEntry(client, {
      restaurantId: RESTAURANT_ID,
      customerId: CUSTOMER_ID,
      currencyCode: CURRENCY,
      entryType: 'credit',
      amountCents: 500,
      referenceType: 'merchant_load',
      referenceId: 'load-1',
      idempotencyKey: 'wallet-load-1',
    }), 'test-atomicity')).rejects.toThrow('scripted failure');
    const walletInsertIndex = order.findIndex((line) => line.includes('INSERT INTO food_customer_wallet_ledger'));
    const failedJournalIndex = order.findIndex((line) => line.includes('INSERT INTO oxsteed_credit_transactions'));
    expect(walletInsertIndex).toBeGreaterThanOrEqual(0);
    expect(failedJournalIndex).toBeGreaterThanOrEqual(0);
    expect(failedJournalIndex).toBeGreaterThan(walletInsertIndex);
  });

  test('a disabled rail lets the food-wallet write proceed and queues the dual-post (fail open)', async () => {
    const { query, dual } = makeWalletClient({ railEnabled: false });
    const result = await applyWalletLedgerEntry({ query }, {
      restaurantId: RESTAURANT_ID,
      customerId: CUSTOMER_ID,
      currencyCode: CURRENCY,
      entryType: 'credit',
      amountCents: 500,
      referenceType: 'merchant_load',
      referenceId: 'load-1',
      idempotencyKey: 'wallet-load-1',
    });
    expect(result.entry.id).toBe(7001);
    expect(dual.issued).toHaveLength(0);
    expect(dual.backfilled).toHaveLength(1);
    expect(dual.backfilled[0].ledger_entry_id).toBe('7001');
  });
});

describe('migration 655 (static)', () => {
  const BACKFILL_SQL = fs.readFileSync(
    path.join(__dirname, '..', 'migrations', '655_credit_dual_posting_backfill.sql'),
    'utf8'
  );

  test('creates the credit_dual_posting_backfill queue table', () => {
    expect(BACKFILL_SQL).toContain('CREATE TABLE IF NOT EXISTS credit_dual_posting_backfill');
    expect(BACKFILL_SQL).toContain('idempotency_key  TEXT NOT NULL UNIQUE');
    expect(BACKFILL_SQL).toContain("status           TEXT NOT NULL DEFAULT 'pending'");
    expect(BACKFILL_SQL).toContain('idx_credit_dual_posting_backfill_pending');
  });
});

describe('dual-posting backfill replay', () => {
  const { replayDualPostingBackfill } = require('../services/oxsteedCreditSubBankService');

  function makeBackfillRow(overrides = {}) {
    return {
      id: 'bf-1',
      ledger_entry_id: '7001',
      restaurant_id: String(RESTAURANT_ID),
      customer_id: CUSTOMER_ID,
      currency_code: CURRENCY,
      amount_cents: 500,
      entry_type: 'credit',
      reference_type: 'merchant_load',
      reference_id: 'load-1',
      actor_type: 'system',
      actor_user_id: null,
      created_by_user_id: null,
      correlation_id: 'corr-1',
      request_ip: '127.0.0.1',
      metadata: {},
      status: 'pending',
      attempts: 0,
      ...overrides,
    };
  }

  function makeReplayPool({ railEnabled = true, backfillRows = [] } = {}) {
    const dual = makeDualPostMock({ railEnabled: true });
    const updates = [];
    const handleQuery = jest.fn(async (text, params = []) => {
      const sql = String(text);
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };
      if (sql.includes("FROM feature_flags WHERE key = 'oxsteed_credit_enabled'")) {
        return railEnabled ? { rows: [{ is_enabled: true }] } : { rows: [{ is_enabled: false }] };
      }
      if (sql.includes('FROM credit_dual_posting_backfill')) return { rows: backfillRows };
      if (sql.includes('UPDATE credit_dual_posting_backfill')) {
        updates.push({ sql, params });
        return { rows: [], rowCount: 1 };
      }
      return dual.mockQuery(text, params);
    });
    const client = { query: handleQuery, release: jest.fn() };
    const pool = { query: handleQuery, connect: jest.fn(async () => client) };
    return { pool, client, updates, dual };
  }

  test('replay posts queued dual-postings and marks them processed', async () => {
    const { pool, updates, dual } = makeReplayPool({ backfillRows: [makeBackfillRow()] });
    const result = await replayDualPostingBackfill(pool, { limit: 10 });
    expect(result.replayed).toBe(1);
    expect(result.failed).toBe(0);
    expect(dual.issued).toHaveLength(1);
    expect(dual.issued[0].idempotency_key).toBe('food-wallet-ledger:7001:central');
    expect(updates).toHaveLength(1);
    expect(updates[0].params[0]).toBe('bf-1');
    expect(updates[0].sql).toContain("status = 'processed'");
  });

  test('replay is a no-op while the rail is disabled', async () => {
    const { pool, updates, dual } = makeReplayPool({ railEnabled: false, backfillRows: [makeBackfillRow()] });
    const result = await replayDualPostingBackfill(pool, { limit: 10 });
    expect(result).toMatchObject({ replayed: 0, skipped: 'rail_disabled' });
    expect(dual.issued).toHaveLength(0);
    expect(updates).toHaveLength(0);
  });

  test('replay retries a failing row and keeps it pending', async () => {
    const { pool, updates } = makeReplayPool({
      backfillRows: [makeBackfillRow({ reference_type: 'brand_new_reference', attempts: 0 })],
    });
    const result = await replayDualPostingBackfill(pool, { limit: 10 });
    expect(result.replayed).toBe(0);
    expect(updates).toHaveLength(1);
    expect(updates[0].sql).toContain("status = $2");
    expect(updates[0].params[1]).toBe('pending');
    expect(updates[0].params[2]).toBe(1);
  });

  test('replay parks a row as failed after max attempts', async () => {
    const { pool, updates } = makeReplayPool({
      backfillRows: [makeBackfillRow({ reference_type: 'brand_new_reference', attempts: 4 })],
    });
    const result = await replayDualPostingBackfill(pool, { limit: 10 });
    expect(result.replayed).toBe(0);
    expect(result.parked).toBe(1);
    expect(updates).toHaveLength(1);
    expect(updates[0].params[1]).toBe('failed');
    expect(updates[0].params[2]).toBe(5);
  });
});
