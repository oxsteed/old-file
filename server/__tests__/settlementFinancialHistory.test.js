'use strict';

const { projectBusiness, projectHelper } = require('../services/settlementFinancialHistory');

const businessId = '42';
const helperId = '00000000-0000-4000-8000-000000000042';

function sourceRow({ id, kind, sourceId, scopeId, operation, recordedAt, source }) {
  return {
    id: String(id),
    source_kind: kind,
    source_id: String(sourceId),
    scope_id: String(scopeId),
    currency_code: 'USD',
    operation,
    recorded_at: `2026-${recordedAt}T12:00:00.000Z`,
    source,
  };
}

describe('settlement source history period continuity', () => {
  test('R03 carries a previously issued invoice into opening receivables and records the later payment', () => {
    const rows = [
      sourceRow({ id: 1, kind: 'business_invoice', sourceId: 71, scopeId: businessId,
        operation: 'insert', recordedAt: '08-10', source: {
          status: 'sent', total: '100.00', amount_paid: '0.00', invoice_number: 'INV-71',
          issue_date: '2026-08-10', client_name: 'Client',
        } }),
      sourceRow({ id: 2, kind: 'business_invoice', sourceId: 71, scopeId: businessId,
        operation: 'update', recordedAt: '09-05', source: {
          status: 'paid', total: '100.00', amount_paid: '100.00', invoice_number: 'INV-71',
          issue_date: '2026-08-10', paid_at: '2026-09-05T12:00:00.000Z', client_name: 'Client',
        } }),
    ];
    const common = { businessId, currency: 'USD', now: '2026-10-15T00:00:00.000Z' };

    const august = projectBusiness(rows, { ...common, period: { from: '2026-08-01', to: '2026-08-31' } });
    expect(august).toMatchObject({ invoicedCents: 10000, collectedOrAdjustedCents: 0, closingOutstandingCents: 10000 });

    const september = projectBusiness(rows, { ...common, period: { from: '2026-09-01', to: '2026-09-30' } });
    expect(september).toMatchObject({ openingOutstandingCents: 10000, invoicedCents: 0,
      collectedOrAdjustedCents: 10000, closingOutstandingCents: 0 });
    expect(september.movements).toHaveLength(1);
    expect(september.movements[0]).toMatchObject({ sourceHistoryId: '2', collectedOrAdjustedCents: 10000 });
  });

  test('R04 records a payout reversal in its actual later period and restores the payable', () => {
    const base = {
      assigned_helper_id: helperId, status: 'completed', completed_at: '2026-08-10T12:00:00.000Z',
      helper_payout_cents: 10000, platform_fee_cents: 1500, customer_total_cents: 11500,
    };
    const rows = [
      sourceRow({ id: 10, kind: 'helper_job', sourceId: 91, scopeId: helperId,
        operation: 'insert', recordedAt: '08-10', source: { ...base, payout_status: 'earned', paid_at: null } }),
      sourceRow({ id: 11, kind: 'helper_job', sourceId: 91, scopeId: helperId,
        operation: 'update', recordedAt: '09-05', source: { ...base, payout_status: 'paid', paid_at: '2026-09-05T12:00:00.000Z' } }),
      sourceRow({ id: 12, kind: 'helper_job', sourceId: 91, scopeId: helperId,
        operation: 'update', recordedAt: '10-03', source: { ...base, payout_status: 'reversed', paid_at: '2026-09-05T12:00:00.000Z' } }),
    ];
    const common = { helperId, currency: 'USD', now: '2026-11-01T00:00:00.000Z' };

    const september = projectHelper(rows, { ...common, period: { from: '2026-09-01', to: '2026-09-30' } });
    expect(september).toMatchObject({ openingPayableCents: 10000, settledPayoutsCents: 10000, closingPayableCents: 0 });

    const october = projectHelper(rows, { ...common, period: { from: '2026-10-01', to: '2026-10-31' } });
    expect(october).toMatchObject({ openingPayableCents: 0, settledPayoutsCents: -10000, closingPayableCents: 10000 });
    expect(october.settled).toHaveLength(1);
    expect(october.settled[0]).toMatchObject({ kind: 'settlement_reversal', helperPayoutCents: -10000, recordedAt: '2026-10-03T12:00:00.000Z' });
  });
});
