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
