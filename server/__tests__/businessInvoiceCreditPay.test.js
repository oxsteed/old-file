'use strict';

const { mockQuery, resetMocks } = require('./setup');
const {
  evaluateInvoiceCreditEligibility,
  payBusinessInvoiceWithCredit,
  syncInvoicePaidFromCreditLedger,
} = require('../services/businessInvoiceCreditPayService');
const creditService = require('../services/oxsteedCreditService');
const adapter = require('../services/creditSpendAdapter');

jest.mock('../services/creditSpendAdapter', () => {
  const actual = jest.requireActual('../services/creditSpendAdapter');
  return {
    ...actual,
    spendWithCreditInTransaction: jest.fn(),
    resolveSpendParticipant: jest.fn(),
  };
});

function mockResponse() {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
}

beforeEach(() => {
  resetMocks();
  jest.restoreAllMocks();
  delete process.env.BUSINESS_INVOICE_CREDIT_PAY_ENABLED;
  adapter.spendWithCreditInTransaction.mockReset();
  adapter.resolveSpendParticipant.mockReset();
});

describe('business invoice credit pay', () => {
  test('evaluateInvoiceCreditEligibility hides when launch flag off', async () => {
    const invoice = {
      id: 9,
      business_id: 3,
      user_id: 'issuer',
      status: 'sent',
      total: '50.00',
      amount_paid: '0',
      currency_code: 'USD',
      client_email: 'payer@example.com',
    };
    const result = await evaluateInvoiceCreditEligibility(invoice, {
      id: 'payer',
      email: 'payer@example.com',
    });
    expect(result.eligible).toBe(false);
    expect(result.code).toBe('invoice_credit_pay_disabled');
  });

  test('payBusinessInvoiceWithCredit rejects impersonation', async () => {
    process.env.BUSINESS_INVOICE_CREDIT_PAY_ENABLED = '1';
    jest.spyOn(creditService, 'isCreditRailEnabled').mockResolvedValue(true);
    mockQuery.mockResolvedValueOnce({
      rows: [{
        id: 9,
        business_id: 3,
        user_id: 'issuer',
        status: 'sent',
        total: '10.00',
        amount_paid: '0',
        currency_code: 'USD',
        client_email: 'payer@example.com',
      }],
    });
    adapter.resolveSpendParticipant.mockResolvedValue({ partnerId: 42 });
    jest.spyOn(adapter, 'resolveSpendParticipant');

    await expect(
      payBusinessInvoiceWithCredit({
        invoiceId: '9',
        user: { id: 'payer', email: 'payer@example.com' },
        idempotencyKey: 'idem-1',
        isImpersonated: true,
      }),
    ).rejects.toMatchObject({ code: 'impersonation_blocked' });
  });

  test('syncInvoicePaidFromCreditLedger aligns amount_paid to ledger purchases', async () => {
    const client = {
      query: jest.fn(async (sql) => {
        if (sql.includes('SUM(t.amount_cents)')) {
          return { rows: [{ total: '2500' }] };
        }
        if (sql.includes('FOR UPDATE')) {
          return {
            rows: [{
              id: 9,
              total: '50.00',
              amount_paid: '0',
              status: 'sent',
            }],
          };
        }
        if (sql.includes('UPDATE business_invoices')) {
          return {
            rows: [{
              id: 9,
              total: '50.00',
              amount_paid: '25.00',
              status: 'partial',
            }],
          };
        }
        return { rows: [] };
      }),
    };

    const updated = await syncInvoicePaidFromCreditLedger(client, 9);
    expect(updated.amount_paid).toBe('25.00');
    expect(updated.status).toBe('partial');
  });
});

describe('businessInvoiceCreditController', () => {
  test('getInvoiceCreditEligibility returns launch hidden without DB hit', async () => {
    const ctrl = require('../controllers/businessInvoiceCreditController');
    const req = { params: { id: '12' }, user: { id: 'u1', email: 'a@b.com' } };
    const res = mockResponse();
    await ctrl.getInvoiceCreditEligibility(req, res, jest.fn());
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      eligible: false,
      code: 'invoice_credit_pay_disabled',
    }));
  });
});
