'use strict';

const { mockQuery, resetMocks } = require('./setup');

const mockEnsureAccount = jest.fn();
const mockPostJournalTransaction = jest.fn();
const mockAssertCreditRailEnabled = jest.fn();

jest.mock('../services/oxsteedCreditService', () => ({
  assertSupportedCreditCurrency: jest.fn((value) => String(value).toUpperCase()),
  ensureAccount: (...args) => mockEnsureAccount(...args),
  postJournalTransaction: (...args) => mockPostJournalTransaction(...args),
  formatAccount: jest.fn((account) => account),
  assertCreditRailEnabled: (...args) => mockAssertCreditRailEnabled(...args),
}));

const { recordPartnerFunding } = require('../services/oxsteedCreditPartnerLedgerService');

beforeEach(() => {
  resetMocks();
  mockEnsureAccount.mockReset();
  mockPostJournalTransaction.mockReset();
  mockAssertCreditRailEnabled.mockReset();
  mockAssertCreditRailEnabled.mockResolvedValue(undefined);
  mockEnsureAccount
    .mockResolvedValueOnce({ id: 701 })
    .mockResolvedValueOnce({ id: 702 })
    .mockResolvedValueOnce({ id: 703 });
  mockPostJournalTransaction.mockResolvedValue({ transaction: { id: 'transaction-1' } });
  mockQuery
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [{ id: 41, settlement_currency_code: 'USD', status: 'active' }] })
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [{
      ledger_id: 900,
      partner_id: 41,
      restaurant_id: 12,
      restaurant_name: 'OxSteed Cafe',
      ledger_code: 'restaurant-credit:41:USD',
      currency_code: 'USD',
      ledger_status: 'active',
      partner_status: 'active',
      payable_account_id: 701,
      reserve_account_id: 702,
    }] })
    .mockResolvedValueOnce({ rows: [{
      id: 'funding-1',
      partner_ledger_id: 900,
      partner_id: 41,
      reserve_account_id: 702,
      transaction_id: 'transaction-1',
      direction: 'fund',
      amount_cents: '2000',
      currency_code: 'USD',
      external_reference: 'bank-transfer-1',
      idempotency_key: 'funding-1',
      reason: 'Initial reserve funding',
    }] })
    .mockResolvedValueOnce({ rows: [] });
});

test('passes the validated funding amount to the journal transaction', async () => {
  const result = await recordPartnerFunding({
    partnerId: 41,
    currencyCode: 'USD',
    amountCents: 2000,
    direction: 'fund',
    externalReference: 'bank-transfer-1',
    idempotencyKey: 'funding-1',
    actorUserId: '22222222-2222-4222-8222-222222222222',
    reason: 'Initial reserve funding',
  });

  expect(result.record.amountCents).toBe(2000);
  expect(mockPostJournalTransaction).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
    transactionType: 'funding',
    amountCents: 2000,
    debitAccountId: 703,
    creditAccountId: 702,
  }));
});

test('funding is rejected for a non-active partner (M27c)', async () => {
  mockQuery.mockReset();
  const now = new Date().toISOString();
  mockQuery.mockImplementation(async (text) => {
    const sql = String(text);
    if (sql.includes('FROM oxsteed_credit_partners') && sql.includes('WHERE id = $1')) {
      return { rows: [{ id: 41, settlement_currency_code: 'USD', status: 'suspended' }] };
    }
    if (sql.includes('FROM oxsteed_credit_partner_ledgers l')) {
      return { rows: [{ ledger_id: 900, partner_id: 41, currency_code: 'USD', ledger_status: 'active', partner_status: 'suspended', payable_account_id: 701, reserve_account_id: 702, updated_at: now }] };
    }
    return { rows: [], rowCount: 0 };
  });

  await expect(recordPartnerFunding({
    partnerId: 41,
    amountCents: 1000,
    externalReference: 'bank-transfer-suspended',
    idempotencyKey: 'funding-suspended-1',
    actorUserId: '22222222-2222-4222-8222-222222222222',
    reason: 'Suspended partner funding attempt',
  })).rejects.toMatchObject({ code: 'credit_partner_not_active', status: 409 });

  // No journal posting and no funding row for a suspended partner.
  expect(mockPostJournalTransaction).not.toHaveBeenCalled();
  expect(mockQuery.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO oxsteed_credit_partner_funding_records'))).toBe(false);
});

test('concurrent funding loses the insert race and replays the winner without double-posting (M26)', async () => {
  mockQuery.mockReset();
  const now = new Date().toISOString();
  const winner = {
    id: 'funding-race-1', partner_ledger_id: 900, partner_id: 41, reserve_account_id: 702,
    transaction_id: 'transaction-race-1', direction: 'fund', amount_cents: 3000,
    currency_code: 'USD', external_reference: 'bank-transfer-race', idempotency_key: 'funding-race-1',
    reason: 'Race funding', actor_user_id: '22222222-2222-4222-8222-222222222222', created_at: now,
  };
  let fundingLookupCalls = 0;
  mockQuery.mockImplementation(async (text) => {
    const sql = String(text);
    if (sql.includes('FROM oxsteed_credit_partners') && sql.includes('WHERE id = $1')) return { rows: [{ id: 41, settlement_currency_code: 'USD', status: 'active' }] };
    if (sql.includes('FROM oxsteed_credit_partner_ledgers l')) {
      return { rows: [{ ledger_id: 900, partner_id: 41, currency_code: 'USD', ledger_status: 'active', partner_status: 'active', payable_account_id: 701, reserve_account_id: 702, updated_at: now }] };
    }
    if (sql.includes('FROM oxsteed_credit_partner_funding_records WHERE idempotency_key')) {
      fundingLookupCalls += 1;
      // The pre-insert replay check misses; the post-race re-read finds the winner.
      return fundingLookupCalls === 1 ? { rows: [] } : { rows: [winner] };
    }
    if (sql.includes('INSERT INTO oxsteed_credit_partner_funding_records')) return { rows: [] }; // lost the race
    return { rows: [], rowCount: 0 };
  });

  const result = await recordPartnerFunding({
    partnerId: 41,
    amountCents: 3000,
    externalReference: 'bank-transfer-race',
    idempotencyKey: 'funding-race-1',
    actorUserId: '22222222-2222-4222-8222-222222222222',
    reason: 'Race funding',
  });

  expect(result.replayed).toBe(true);
  expect(result.record.id).toBe('funding-race-1');
  // The retry replayed the winner instead of creating a second funding record;
  // the journal post ran once with a deterministic key, so a real retry would
  // replay the winner's journal leg rather than double-post it.
  expect(mockPostJournalTransaction).toHaveBeenCalledTimes(1);
  expect(mockQuery.mock.calls.filter(([sql]) => String(sql).includes('INSERT INTO oxsteed_credit_partner_funding_records'))).toHaveLength(1);
});
