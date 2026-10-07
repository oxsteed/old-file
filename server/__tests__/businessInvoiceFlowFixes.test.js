'use strict';

const { mockQuery, resetMocks } = require('./setup');
const ctrl = require('../controllers/businessInvoiceController');
const mobile = require('../controllers/mobileController');
const { processBusinessInvoiceOverdue } = require('../services/businessInvoiceOverdueWorker');
const {
  resolvePaymentDelta,
  isInvoicePayer,
  validateInvoiceUpdate,
} = require('../utils/businessInvoiceHelpers');

function mockResponse() {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
}

function mockNext() {
  return jest.fn();
}

beforeEach(() => resetMocks());

describe('business invoice flow fixes', () => {
  test('resolvePaymentDelta accumulates partial payments', () => {
    expect(resolvePaymentDelta('10', 100, 0)).toEqual({ value: 10 });
    expect(resolvePaymentDelta('15', 100, 10)).toEqual({ value: 15 });
    expect(resolvePaymentDelta(undefined, 100, 90)).toEqual({ value: 10 });
    expect(resolvePaymentDelta(undefined, 100, 100).error).toMatch(/fully paid/);
    expect(resolvePaymentDelta('60', 100, 100)).toEqual({ value: -40, targetPaid: 60 });
    expect(resolvePaymentDelta('60', 100, 70)).toEqual({ value: -10, targetPaid: 60 });
    expect(resolvePaymentDelta('100', 100, 60)).toEqual({ value: 40 });
  });

  test('isInvoicePayer rejects issuer and accepts client email match', () => {
    const invoice = { user_id: 'issuer', client_email: 'client@example.com' };
    expect(isInvoicePayer(invoice, { id: 'issuer', email: 'client@example.com' })).toBe(false);
    expect(isInvoicePayer(invoice, { id: 'payer', email: 'client@example.com' })).toBe(true);
  });

  test('validateInvoiceUpdate blocks line item edits after sent', () => {
    const err = validateInvoiceUpdate({ status: 'sent' }, { line_items: [{ description: 'x' }] });
    expect(err).toMatch(/cannot be changed/);
  });

  test('createInvoice returns 400 without leaving an open transaction', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 8, owner_id: '00000000-0000-4000-8000-000000000008' }],
    });

    const req = {
      user: { id: '00000000-0000-4000-8000-000000000008' },
      params: { id: '8' },
      body: { client_name: 'Client', line_items: [], status: 'paid' },
    };
    const res = mockResponse();

    await ctrl.createInvoice(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockQuery.mock.calls.some(([sql]) => String(sql).includes('BEGIN'))).toBe(false);
  });

  test('getPublicInvoice hides draft invoices', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 1, status: 'draft', public_token: 'tok', business_id: 1 }],
    });

    const req = { params: { token: 'tok' } };
    const res = mockResponse();
    await ctrl.getPublicInvoice(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  test('markInvoicePaid accumulates amount_paid', async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [{ id: 8, owner_id: '00000000-0000-4000-8000-000000000008' }],
      })
      .mockResolvedValueOnce({
        rows: [{
          id: 99,
          business_id: 8,
          total: '100.00',
          amount_paid: '25.00',
          status: 'partial',
        }],
      })
      .mockResolvedValueOnce({
        rows: [{ id: 99, amount_paid: '40.00', status: 'partial' }],
      });

    const req = {
      user: { id: '00000000-0000-4000-8000-000000000008' },
      params: { id: '8', invoiceId: '99' },
      body: { amount: '15' },
    };
    const res = mockResponse();
    await ctrl.markInvoicePaid(req, res);

    const updateCall = mockQuery.mock.calls.find(([sql]) => sql.includes('UPDATE business_invoices SET'));
    expect(updateCall[1][0]).toBe(40);
  });

  test('createInvoicePaymentIntent is gated until Connect is enabled', async () => {
    const prev = process.env.BUSINESS_INVOICE_STRIPE_CONNECT_ENABLED;
    delete process.env.BUSINESS_INVOICE_STRIPE_CONNECT_ENABLED;
    process.env.STRIPE_PUBLISHABLE_KEY = 'pk_test';

    const req = { params: { invoiceId: '1' }, user: { id: 'u1', email: 'a@b.com' } };
    const res = { json: jest.fn() };
    const next = mockNext();

    await mobile.createInvoicePaymentIntent(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({
      code: 'invoice_online_payment_unavailable',
      statusCode: 503,
    }));

    if (prev !== undefined) process.env.BUSINESS_INVOICE_STRIPE_CONNECT_ENABLED = prev;
  });

  test('processBusinessInvoiceOverdue delegates to payment reminder worker', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ locked: true }] })
      .mockResolvedValueOnce({ rowCount: 0 })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    await expect(processBusinessInvoiceOverdue()).resolves.toEqual({ locked: true, updated: 0, reminded: 0 });
  });
});
