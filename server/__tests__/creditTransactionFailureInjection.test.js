'use strict';

jest.unmock('../utils/transaction');

jest.mock('../services/oxsteedCreditService', () => ({
  assertSupportedCreditCurrency: jest.fn((currency) => String(currency || '').toUpperCase()),
  assertCreditRailEnabled: jest.fn().mockResolvedValue(undefined),
  ensureAccount: jest.fn(),
  postJournalTransaction: jest.fn(),
  computeEntryHash: jest.fn(),
  getCustomerCreditLimitSummary: jest.fn(),
  listCreditDisputes: jest.fn(),
}));

const { Pool } = require('pg');
const { mockQuery, resetMocks } = require('./setup');
const creditService = require('../services/oxsteedCreditService');
const { recordPartnerFunding } = require('../services/oxsteedCreditPartnerLedgerService');
const { createSettlement } = require('../services/oxsteedCreditAdminService');

function useRealTransactionConnection() {
  const release = jest.fn();
  Pool.mockConnect.mockResolvedValue({
    query: (sql, values) => mockQuery(sql, values),
    release,
  });
  return release;
}

function transactionStatements() {
  return mockQuery.mock.calls.map(([sql]) => String(sql));
}

beforeEach(() => {
  resetMocks();
  useRealTransactionConnection();
  creditService.ensureAccount.mockReset();
  creditService.postJournalTransaction.mockReset();
  creditService.assertCreditRailEnabled.mockReset();
  creditService.assertCreditRailEnabled.mockResolvedValue(undefined);
});

test('rolls back partner reserve setup when the journal post fails', async () => {
  creditService.ensureAccount.mockImplementation(async (_client, { accountType }) => ({
    id: accountType === 'partner_payable' ? 701 : accountType === 'partner_reserve' ? 702 : 900,
  }));
  creditService.postJournalTransaction.mockRejectedValue(new Error('synthetic journal failure'));
  mockQuery.mockImplementation(async (sql) => {
    const statement = String(sql);
    if (statement === 'BEGIN' || statement === 'ROLLBACK') return { rows: [] };
    if (statement.includes('FROM oxsteed_credit_partner_funding_records')) return { rows: [] };
    if (statement.includes('FROM oxsteed_credit_partners')) return { rows: [{ id: 41, settlement_currency_code: 'USD', status: 'active' }] };
    if (statement.includes('INSERT INTO oxsteed_credit_partner_ledgers')) return { rows: [] };
    if (statement.includes('SELECT l.id AS ledger_id')) {
      return { rows: [{ ledger_id: 900, partner_id: 41, ledger_status: 'active', currency_code: 'USD', reserve_account_id: 702 }] };
    }
    throw new Error(`Unexpected SQL in funding failure test: ${statement}`);
  });

  await expect(recordPartnerFunding({
    partnerId: 41,
    amountCents: 1500,
    direction: 'fund',
    externalReference: 'synthetic-bank-reference',
    idempotencyKey: 'synthetic-funding-failure',
    actorUserId: 'admin-1',
    reason: 'Rollback verification',
  })).rejects.toThrow('synthetic journal failure');

  expect(transactionStatements()).toEqual(expect.arrayContaining(['BEGIN', 'ROLLBACK']));
  expect(transactionStatements().some((statement) => statement.includes('INSERT INTO oxsteed_credit_partner_funding_records'))).toBe(false);
  expect(transactionStatements().some((statement) => statement === 'COMMIT')).toBe(false);
});

test('rolls back settlement creation when the settlement insert fails', async () => {
  mockQuery.mockImplementation(async (sql) => {
    const statement = String(sql);
    if (statement === 'BEGIN' || statement === 'ROLLBACK') return { rows: [] };
    if (statement.includes('SELECT a.*, p.status AS partner_status')) {
      return { rows: [{
        id: 'agreement-1',
        partner_id: 41,
        partner_status: 'active',
        restaurant_id: 12,
        restaurant_name: 'Synthetic Cafe',
        settlement_currency_code: 'USD',
        status: 'active',
        starts_at: '2026-01-01T00:00:00.000Z',
        ends_at: null,
      }] };
    }
    if (statement.includes('pg_advisory_xact_lock')) return { rows: [] };
    if (statement.includes('WHERE s.idempotency_key')) return { rows: [] };
    if (statement.includes('period_start <')) return { rows: [] };
    if (statement.includes("FILTER (WHERE t.transaction_type = 'purchase')")) {
      return { rows: [{ gross_cents: '2500', refund_cents: '0', fee_cents: '0' }] };
    }
    if (statement.includes('INSERT INTO oxsteed_credit_settlements')) {
      throw new Error('synthetic settlement insert failure');
    }
    throw new Error(`Unexpected SQL in settlement failure test: ${statement}`);
  });

  await expect(createSettlement({
    partnerId: 41,
    agreementId: 'agreement-1',
    periodStart: '2026-09-01T00:00:00.000Z',
    periodEnd: '2026-09-10T00:00:00.000Z',
    idempotencyKey: 'synthetic-settlement-failure',
    actorUserId: 'admin-1',
    reason: 'Rollback verification',
  })).rejects.toThrow('synthetic settlement insert failure');

  expect(transactionStatements()).toEqual(expect.arrayContaining(['BEGIN', 'ROLLBACK']));
  expect(transactionStatements().some((statement) => statement.includes('credit.settlement.created'))).toBe(false);
  expect(transactionStatements().some((statement) => statement === 'COMMIT')).toBe(false);
});
