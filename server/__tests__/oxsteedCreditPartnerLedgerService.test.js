'use strict';

const { mockQuery, resetMocks } = require('./setup');
const {
  formatPartnerLedger,
  formatFundingRecord,
  getPartnerLedger,
} = require('../services/oxsteedCreditPartnerLedgerService');

const PARTNER_ID = 41;

beforeEach(resetMocks);

test('formats a restaurant ledger with independent payable and reserve accounts', () => {
  const ledger = formatPartnerLedger({
    ledger_id: 900,
    partner_id: PARTNER_ID,
    restaurant_id: 12,
    restaurant_name: 'OxSteed Cafe',
    ledger_code: 'restaurant-credit:41:USD',
    currency_code: 'USD',
    ledger_status: 'active',
    payable_account_id: 701,
    payable_balance_cents: '12500',
    payable_reserved_cents: '0',
    payable_status: 'active',
    payable_ledger_version: '4',
    payable_last_entry_hash: 'payable-hash',
    payable_last_posted_at: '2026-09-14T12:00:00.000Z',
    reserve_account_id: 702,
    reserve_balance_cents: '30000',
    reserve_reserved_cents: '0',
    reserve_status: 'active',
    reserve_ledger_version: '2',
    reserve_last_entry_hash: 'reserve-hash',
    reserve_last_posted_at: '2026-09-14T11:00:00.000Z',
    total_funded_cents: '50000',
    total_released_cents: '20000',
  });

  expect(ledger).toMatchObject({
    id: '900',
    partnerId: '41',
    restaurantId: '12',
    ledgerCode: 'restaurant-credit:41:USD',
    totalFundedCents: 50000,
    totalReleasedCents: 20000,
    payableAccount: { accountId: '701', accountType: 'partner_payable', balanceCents: 12500 },
    reserveAccount: { accountId: '702', accountType: 'partner_reserve', balanceCents: 30000 },
  });
});

test('formats funding records without changing their audit evidence', () => {
  expect(formatFundingRecord({
    id: 'funding-1',
    partner_ledger_id: 900,
    partner_id: PARTNER_ID,
    reserve_account_id: 702,
    transaction_id: 'transaction-1',
    direction: 'fund',
    amount_cents: '10000',
    currency_code: 'USD',
    external_reference: 'bank-transfer-100',
    idempotency_key: 'funding-request-1',
    reason: 'Initial reserve allocation',
    actor_user_id: '22222222-2222-4222-8222-222222222222',
    correlation_id: 'request-1',
    metadata: { source: 'treasury' },
    created_at: '2026-09-14T12:00:00.000Z',
  })).toEqual(expect.objectContaining({
    partnerLedgerId: '900',
    direction: 'fund',
    amountCents: 10000,
    externalReference: 'bank-transfer-100',
    transactionId: 'transaction-1',
  }));
});

test('initializes and returns a restaurant ledger in its settlement currency', async () => {
  mockQuery
    .mockResolvedValueOnce({ rows: [{ settlement_currency_code: 'USD' }] })
    .mockResolvedValueOnce({ rows: [{ id: PARTNER_ID, settlement_currency_code: 'USD', status: 'active' }] })
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [{ id: 701, account_type: 'partner_payable', partner_id: PARTNER_ID, currency_code: 'USD', balance_cents: '0', reserved_cents: '0', status: 'active', ledger_version: '0' }] })
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [{ id: 702, account_type: 'partner_reserve', partner_id: PARTNER_ID, currency_code: 'USD', balance_cents: '0', reserved_cents: '0', status: 'active', ledger_version: '0' }] })
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [{
      ledger_id: 900,
      partner_id: PARTNER_ID,
      restaurant_id: 12,
      restaurant_name: 'OxSteed Cafe',
      ledger_code: 'restaurant-credit:41:USD',
      currency_code: 'USD',
      ledger_status: 'active',
      payable_account_id: 701,
      payable_balance_cents: '0',
      payable_reserved_cents: '0',
      payable_status: 'active',
      payable_ledger_version: '0',
      reserve_account_id: 702,
      reserve_balance_cents: '0',
      reserve_reserved_cents: '0',
      reserve_status: 'active',
      reserve_ledger_version: '0',
      total_funded_cents: '0',
      total_released_cents: '0',
    }] });

  const result = await getPartnerLedger({ partnerId: PARTNER_ID });

  expect(result.ledger).toMatchObject({
    ledgerCode: 'restaurant-credit:41:USD',
    payableAccount: { accountId: '701' },
    reserveAccount: { accountId: '702', accountType: 'partner_reserve' },
  });
  expect(mockQuery.mock.calls.some(([, values]) => values?.includes('partner_reserve'))).toBe(true);
  expect(mockQuery.mock.calls.some(([sql]) => sql.includes('oxsteed_credit_partner_ledgers'))).toBe(true);
});
