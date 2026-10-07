'use strict';

const { mockQuery, resetMocks } = require('./setup');
const { listUserInvoices, decorateInvoiceRow } = require('../services/userInvoicesService');

beforeEach(() => resetMocks());

describe('userInvoicesService', () => {
  test('decorateInvoiceRow builds tool rental deep link', () => {
    const row = decorateInvoiceRow({
      source_id: 42,
      invoice_kind: 'tool_rental',
      invoice_number: 'INV-1',
      created_at: new Date().toISOString(),
      counterparty_name: 'Drill',
      perspective: 'received',
    });
    expect(row.id).toBe('tr-42');
    expect(row.detail_href).toBe('/tool-rentals?rentalInvoiceId=42');
  });

  test('listUserInvoices merges business and tool rental received rows', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ source_id: 1, invoice_kind: 'business', status: 'sent', created_at: '2026-01-02' }] })
      .mockResolvedValueOnce({ rows: [{ source_id: 9, invoice_kind: 'tool_rental', status: 'sent', created_at: '2026-01-03' }] });

    const { invoices, total } = await listUserInvoices({
      userId: 'user-1',
      userEmail: 'payer@example.com',
      view: 'received',
      limit: 10,
      offset: 0,
    });

    expect(total).toBe(2);
    expect(invoices.map((i) => i.invoice_kind).sort()).toEqual(['business', 'tool_rental']);
  });
});
