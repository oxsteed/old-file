'use strict';

const { mockQuery, resetMocks } = require('./setup');
const ctrl = require('../controllers/businessInvoiceController');

function mockResponse() {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
}

beforeEach(() => resetMocks());

describe('business invoice currency contract', () => {
  test('creates business invoices using the business currency code', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 8, owner_id: '00000000-0000-4000-8000-000000000008' }] })
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({ rows: [{ invoice_seq: 12 }] })
      .mockResolvedValueOnce({ rows: [{ currency_code: 'GHS' }] })
      .mockResolvedValueOnce({
        rows: [{
          id: 99,
          business_id: 8,
          invoice_number: 'INV-2026-0012',
          client_name: 'Bon Pate Client',
          status: 'draft',
          subtotal: 25,
          total: 25,
          amount_paid: 0,
          currency_code: 'GHS',
        }],
      })
      .mockResolvedValueOnce({ rows: [] }); // COMMIT

    const req = {
      user: { id: '00000000-0000-4000-8000-000000000008' },
      params: { id: '8' },
      body: {
        client_name: 'Bon Pate Client',
        line_items: [{ description: 'Service', quantity: '1', unit_price: '25' }],
      },
    };
    const res = mockResponse();

    await ctrl.createInvoice(req, res);

    const insertCall = mockQuery.mock.calls.find(([sql]) => sql.includes('INSERT INTO business_invoices'));
    expect(insertCall).toBeTruthy();
    expect(insertCall[1][12]).toBe('GHS');
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({
      invoice: expect.objectContaining({ currency_code: 'GHS' }),
    });
  });

  test('marks an invoice paid with explicitly typed PostgreSQL parameters', async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [{
          id: 8,
          owner_id: '00000000-0000-4000-8000-000000000008',
        }],
      }) // canManageBusinessFinance
      .mockResolvedValueOnce({
        rows: [{
          id: 99,
          business_id: 8,
          user_id: '00000000-0000-4000-8000-000000000008',
          total: '25.00',
          amount_paid: '0.00',
          status: 'sent',
          paid_at: null,
        }],
      }) // current invoice
      .mockResolvedValueOnce({
        rows: [{
          id: 99,
          business_id: 8,
          amount_paid: '25.00',
          status: 'paid',
        }],
      }); // updated invoice

    const req = {
      user: { id: '00000000-0000-4000-8000-000000000008' },
      params: { id: '8', invoiceId: '99' },
      body: { amount: '25' },
    };
    const res = mockResponse();

    await ctrl.markInvoicePaid(req, res);

    const updateCall = mockQuery.mock.calls.find(([sql]) => sql.includes('UPDATE business_invoices SET'));
    expect(updateCall).toBeTruthy();
    expect(updateCall[0]).toMatch(/amount_paid\s*=\s*\$1::numeric\(12,2\)/);
    expect(updateCall[0]).toMatch(/status\s*=\s*\$2::varchar\(20\)/);
    expect(updateCall[0]).toMatch(/CASE WHEN \$2::varchar\(20\) = 'paid'/);
    expect(updateCall[0]).toMatch(/id\s*=\s*\$3::bigint/);
    expect(updateCall[0]).toMatch(/business_id\s*=\s*\$4::integer/);
    expect(updateCall[0]).toMatch(/user_id\s*=\s*\$5::uuid/);
    expect(updateCall[1]).toEqual([25, 'paid', '99', 8, '00000000-0000-4000-8000-000000000008']);
    expect(res.json).toHaveBeenCalledWith({
      invoice: expect.objectContaining({ id: 99, status: 'paid' }),
    });
  });
});
