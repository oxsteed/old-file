'use strict';

const { mockQuery, resetMocks } = require('./setup');
const ExportService = require('../services/ExportService');

describe('ExportService PDF reports', () => {
  beforeEach(() => resetMocks());

  test('generates a real payout PDF without selecting payout-method secrets', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{
        id: 42,
        period_start: '2026-09-01',
        period_end: '2026-09-07',
        gross_payout_cents: 12500,
        processor_fee_cents: 250,
        net_payout_cents: 12250,
        status: 'paid',
        payment_processor: 'stripe',
        created_at: '2026-09-08T12:00:00.000Z',
      }],
    });

    const report = await ExportService.generatePayoutPDF('helper-1', [42]);

    expect(report.filename).toMatch(/^payouts-\d{4}-\d{2}-\d{2}\.pdf$/);
    expect(report.data.subarray(0, 5).toString()).toBe('%PDF-');
    expect(report.data.length).toBeGreaterThan(500);
    expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('SELECT id, period_start'), ['helper-1', [42]]);
    expect(mockQuery.mock.calls[0][0]).not.toMatch(/payment_identifier|paypal_email|bank_name/i);
  });

  test('generates a valid analytics PDF for empty and populated sections', async () => {
    const report = await ExportService.generateAnalyticsPDF(
      'program-1',
      'helper-1',
      [{ metric_date: '2026-09-07', total_clicks: 10, total_conversions: 2, conversion_rate: 20, total_order_value_cents: 5000 }],
      [{ stage: 'clicked', count: 10 }],
      [{ rank: 1, product_name: 'Service', total_clicks_30d: 10, total_conversions_30d: 2, total_revenue_30d_cents: 5000 }],
    );

    expect(report.filename).toMatch(/^analytics-\d{4}-\d{2}-\d{2}\.pdf$/);
    expect(report.data.subarray(0, 5).toString()).toBe('%PDF-');
    expect(report.data.length).toBeGreaterThan(500);
  });
});
