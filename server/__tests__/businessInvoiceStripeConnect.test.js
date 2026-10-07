'use strict';

const { mockQuery, resetMocks } = require('./setup');
const { AppError } = require('../middleware/errorHandler');
const {
  resolveInvoiceStripeConnectDestination,
  buildDestinationChargeParams,
  assertPaymentIntentMatchesInvoice,
  evaluateInvoiceCardEligibility,
  applyInvoiceCardPayment,
} = require('../services/businessInvoiceStripeConnectService');

beforeEach(() => {
  resetMocks();
  delete process.env.BUSINESS_INVOICE_STRIPE_CONNECT_ENABLED;
});

describe('business invoice Stripe Connect', () => {
  test('resolveInvoiceStripeConnectDestination uses business Standard account when charges enabled', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{
        id: 3,
        stripe_account_id: 'acct_biz_1',
        stripe_charges_enabled: true,
        stripe_payouts_enabled: true,
        stripe_account_status: 'active',
      }],
    });

    const result = await resolveInvoiceStripeConnectDestination({
      business_id: 3,
      user_id: 'issuer',
    });

    expect(result.accountId).toBe('acct_biz_1');
    expect(result.source).toBe('business_standard');
    expect(result.chargesEnabled).toBe(true);
  });

  test('resolveInvoiceStripeConnectDestination fails closed when charges disabled', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{
        id: 3,
        stripe_account_id: 'acct_incomplete',
        stripe_charges_enabled: false,
        stripe_payouts_enabled: false,
        stripe_account_status: 'pending',
      }],
    });

    const result = await resolveInvoiceStripeConnectDestination({
      business_id: 3,
    });

    expect(result.ready).toBe(false);
    expect(result.reason).toBe('charges_disabled');
  });

  test('buildDestinationChargeParams includes transfer_data destination and metadata', () => {
    const params = buildDestinationChargeParams({
      invoice: { id: 42, business_id: 1, user_id: 'u1' },
      connect: { accountId: 'acct_dest', source: 'business_standard' },
      payerUserId: 'payer-1',
      amountCents: 5000,
      currency: 'usd',
      idempotencyKey: 'key-1',
    });

    expect(params.transfer_data).toEqual({ destination: 'acct_dest' });
    expect(params.metadata.business_invoice_payment).toBe('true');
    expect(params.metadata.invoice_id).toBe('42');
    expect(params.metadata.connect_account_id).toBe('acct_dest');
  });

  test('assertPaymentIntentMatchesInvoice rejects wrong Connect destination', () => {
    expect(() => assertPaymentIntentMatchesInvoice({
      paymentIntent: {
        status: 'succeeded',
        amount: 1000,
        amount_received: 1000,
        currency: 'usd',
        transfer_data: { destination: 'acct_wrong' },
        metadata: {
          business_invoice_payment: 'true',
          invoice_id: '9',
          payer_id: 'payer',
        },
      },
      invoice: { id: 9, currency_code: 'USD' },
      payerUserId: 'payer',
      connect: { accountId: 'acct_right' },
      expectedAmountCents: 1000,
    })).toThrow(AppError);
  });

  test('evaluateInvoiceCardEligibility hides when launch flag off', async () => {
    const result = await evaluateInvoiceCardEligibility(
      {
        id: 1,
        business_id: 2,
        status: 'sent',
        total: '10.00',
        amount_paid: '0',
        currency_code: 'USD',
        client_email: 'p@example.com',
        user_id: 'issuer',
      },
      { id: 'payer', email: 'p@example.com' },
    );
    expect(result.eligible).toBe(false);
    expect(result.code).toBe('invoice_card_pay_disabled');
  });

  test('applyInvoiceCardPayment does not overpay', async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [{
          id: 5,
          total: '100.00',
          amount_paid: '90.00',
          status: 'partial',
        }],
      })
      .mockResolvedValueOnce({
        rows: [{
          id: 5,
          total: '100.00',
          amount_paid: '100.00',
          status: 'paid',
        }],
      });

    const client = { query: mockQuery };
    const updated = await applyInvoiceCardPayment(client, { invoiceId: 5, amountDollars: 20 });
    expect(updated.status).toBe('paid');
    const updateCall = mockQuery.mock.calls[1];
    expect(updateCall[1][0]).toBe(100);
  });
});
