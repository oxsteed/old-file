'use strict';

const { mockQuery, resetMocks } = require('./setup');
const {
  createWalletHold,
  transferWalletCredit,
} = require('../services/foodWalletOperationsService');

const RESTAURANT_ID = 3;
const SENDER_ID = '00000000-0000-4000-8000-000000000111';
const RECIPIENT_ID = '00000000-0000-4000-8000-000000000222';

function account(id, customerId, balanceCents, reservedCents = 0) {
  return {
    id,
    restaurant_id: RESTAURANT_ID,
    customer_id: customerId,
    currency_code: 'USD',
    balance_cents: balanceCents,
    reserved_cents: reservedCents,
    status: 'active',
    ledger_version: 0,
    last_entry_hash: null,
  };
}

beforeEach(() => resetMocks());

describe('restaurant wallet bank-like operations', () => {
  test('creates a hold by reserving only the available balance', async () => {
    const sender = account(11, SENDER_ID, 5000, 1000);
    mockQuery.mockImplementation(async (sql) => {
      if (/INSERT INTO food_customer_wallet_accounts/.test(sql)) return { rows: [] };
      if (/FROM food_customer_wallet_accounts a/.test(sql) && /FOR UPDATE/.test(sql)) return { rows: [sender] };
      if (/FROM food_customer_wallet_holds/.test(sql) && /idempotency_key/.test(sql)) return { rows: [] };
      if (/expires_at <= NOW/.test(sql)) return { rows: [] };
      if (/SET reserved_cents = reserved_cents \+/.test(sql)) {
        return { rows: [{ ...sender, reserved_cents: 2500 }] };
      }
      if (/INSERT INTO food_customer_wallet_holds/.test(sql)) {
        return {
          rows: [{
            id: '10000000-0000-4000-8000-000000000001',
            restaurant_id: RESTAURANT_ID,
            account_id: sender.id,
            customer_id: SENDER_ID,
            amount_cents: 1500,
            currency_code: 'USD',
            status: 'active',
            expires_at: new Date(Date.now() + 60000),
            metadata: {},
          }],
        };
      }
      return { rows: [] };
    });

    const result = await createWalletHold({ query: mockQuery }, {
      restaurantId: RESTAURANT_ID,
      customerId: SENDER_ID,
      currencyCode: 'USD',
      amountCents: 1500,
      expiresAt: new Date(Date.now() + 60000),
      idempotencyKey: 'hold-1',
    });

    expect(result.hold.amount_cents).toBe(1500);
    expect(mockQuery.mock.calls.some(([sql]) => /balance_cents - reserved_cents >=/.test(sql))).toBe(true);
    expect(mockQuery.mock.calls.some(([sql]) => /INSERT INTO food_customer_wallet_ledger/.test(sql))).toBe(false);
  });

  test('transfers credit atomically between two wallets at the same restaurant', async () => {
    const sender = account(11, SENDER_ID, 5000);
    const recipient = account(12, RECIPIENT_ID, 2000);
    let senderReads = 0;
    let recipientReads = 0;
    mockQuery.mockImplementation(async (sql, params) => {
      if (/FROM food_customer_wallet_transfers/.test(sql) && /idempotency_key/.test(sql)) return { rows: [] };
      if (/INSERT INTO food_customer_wallet_accounts/.test(sql) && /VALUES \(\$1,\$2,\$4\)/.test(sql)) return { rows: [] };
      if (/customer_id = ANY/.test(sql)) return { rows: [sender, recipient] };
      if (/INSERT INTO food_customer_wallet_accounts/.test(sql)) return { rows: [] };
      if (/FROM food_customer_wallet_accounts a/.test(sql) && /FOR UPDATE/.test(sql)) {
        if (params[1] === SENDER_ID) {
          senderReads += 1;
          return { rows: [senderReads > 1 ? { ...sender, balance_cents: 3500, ledger_version: 1 } : sender] };
        }
        recipientReads += 1;
        return { rows: [recipientReads > 1 ? { ...recipient, balance_cents: 3500, ledger_version: 1 } : recipient] };
      }
      if (/FROM food_customer_wallet_ledger/.test(sql)) return { rows: [] };
      if (/UPDATE food_customer_wallet_accounts/.test(sql)) {
        const isSender = Number(params[4]) === sender.id;
        return {
          rows: [{
            ...(isSender ? sender : recipient),
            balance_cents: isSender ? 3500 : 3500,
            ledger_version: 1,
            last_entry_hash: params[3],
          }],
        };
      }
      if (/INSERT INTO food_customer_wallet_ledger/.test(sql)) {
        return {
          rows: [{
            id: params[3] === 'debit' ? 101 : 102,
            account_id: params[0],
            restaurant_id: RESTAURANT_ID,
            customer_id: params[2],
            entry_type: params[3],
            amount_cents: params[4],
            balance_after_cents: params[5],
            currency_code: 'USD',
            metadata: {},
          }],
        };
      }
      if (/INSERT INTO food_customer_wallet_transfers/.test(sql)) {
        return {
          rows: [{
            id: params[0],
            restaurant_id: RESTAURANT_ID,
            sender_customer_id: SENDER_ID,
            recipient_customer_id: RECIPIENT_ID,
            sender_account_id: sender.id,
            recipient_account_id: recipient.id,
            amount_cents: 1500,
            currency_code: 'USD',
            status: 'completed',
            idempotency_key: 'transfer-1',
            debit_ledger_entry_id: 101,
            credit_ledger_entry_id: 102,
            metadata: {},
          }],
        };
      }
      return { rows: [] };
    });

    const result = await transferWalletCredit({ query: mockQuery }, {
      restaurantId: RESTAURANT_ID,
      senderCustomerId: SENDER_ID,
      recipientCustomerId: RECIPIENT_ID,
      currencyCode: 'USD',
      amountCents: 1500,
      idempotencyKey: 'transfer-1',
    });

    expect(result.transfer.status).toBe('completed');
    const ledgerInserts = mockQuery.mock.calls.filter(([sql]) => /INSERT INTO food_customer_wallet_ledger/.test(sql));
    expect(ledgerInserts).toHaveLength(2);
    expect(ledgerInserts.map(([, params]) => params[3])).toEqual(['debit', 'credit']);
  });
});
