'use strict';

const { mockQuery, resetMocks } = require('./setup');
const {
  resolveBusinessInvoiceConnect,
  normalizeAccountId,
} = require('../services/stripeConnectSoTService');

beforeEach(() => {
  resetMocks();
});

describe('stripeConnectSoT', () => {
  test('normalizeAccountId trims empty', () => {
    expect(normalizeAccountId(' acct_1 ')).toBe('acct_1');
    expect(normalizeAccountId('')).toBeNull();
  });

  test('resolveBusinessInvoiceConnect prefers business OAuth over RCA', async () => {
    const bizRow = {
      rows: [{
        id: 3,
        stripe_account_id: 'acct_biz',
        stripe_charges_enabled: true,
        stripe_payouts_enabled: true,
        stripe_account_status: 'active',
      }],
    };
    mockQuery
      .mockResolvedValueOnce({ rows: [{ '?column?': 1 }] }) // has restaurants
      .mockResolvedValueOnce(bizRow) // sync: load business
      .mockResolvedValueOnce({ rowCount: 0 }) // sync insert
      .mockResolvedValueOnce({ rowCount: 0 }) // sync update
      .mockResolvedValueOnce(bizRow) // resolve: load business
      .mockResolvedValueOnce({
        rows: [{
          stripe_account_id: 'acct_biz',
          charges_enabled: true,
          payouts_enabled: true,
          restaurant_id: 9,
        }],
      });

    const result = await resolveBusinessInvoiceConnect(undefined, 3);
    expect(result.source).toBe('business_standard');
    expect(result.accountId).toBe('acct_biz');
  });

  test('resolveBusinessInvoiceConnect fails closed on account mismatch', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] }) // no restaurants
      .mockResolvedValueOnce({
        rows: [{
          id: 3,
          stripe_account_id: 'acct_oauth',
          stripe_charges_enabled: true,
          stripe_payouts_enabled: false,
          stripe_account_status: 'active',
        }],
      })
      .mockResolvedValueOnce({
        rows: [{
          stripe_account_id: 'acct_food',
          charges_enabled: true,
          payouts_enabled: true,
          restaurant_id: 2,
        }],
      });

    const result = await resolveBusinessInvoiceConnect(undefined, 3);
    expect(result.reason).toBe('stripe_connect_accounts_mismatch');
    expect(result.divergence.businessAccountId).toBe('acct_oauth');
    expect(result.divergence.restaurantConnectAccountId).toBe('acct_food');
  });
});
