'use strict';

const service = require('../services/statementAmendmentService');
const { projectHelper, projectBusiness } = require('../services/settlementFinancialHistory');
const { assertSettlementRestatedDelta, fetchSettlementCompensatingRef, checkContinuity } = service.testHooks;
const { Pool } = require('pg');

const period = { from: '2026-09-01', to: '2026-09-30' };
const now = '2026-10-01T00:00:00Z';
const helperId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
function helperRow(id, recordedAt, amount) {
  return { id: String(id), source_id: 'job-1', source_kind: 'helper_job', scope_id: helperId,
    currency_code: 'USD', operation: id === 1 ? 'insert' : 'update', recorded_at: recordedAt,
    source: { id: 'job-1', completed_at: '2026-08-03T00:00:00Z', helper_payout_cents: amount,
      payout_status: 'earned', status: 'completed', paid_at: null, platform_fee_cents: 0, customer_total_cents: amount } };
}
function invoiceRow(id, recordedAt, paid) {
  return { id: String(id), source_id: 'invoice-1', source_kind: 'business_invoice', scope_id: '9',
    currency_code: 'USD', operation: id === 1 ? 'insert' : 'update', recorded_at: recordedAt,
    source: { id: 'invoice-1', issue_date: '2026-08-03', total: '100', amount_paid: paid,
      status: paid === '100' ? 'paid' : paid === '0' ? 'sent' : 'partial' } };
}
const core = document => service.coreOf(document);
const business = rows => ({ product: 'business', receivables: projectBusiness(rows, { businessId: 9, currency: 'USD', period, now }), payables: { expenses: [], expenseTotalCents: 0 } });
const helper = rows => ({ product: 'helper_earnings', ...projectHelper(rows, { helperId, currency: 'USD', period, now }) });
const assertDelta = (baseline, revised, refs) => assertSettlementRestatedDelta({ baselineCore: core(baseline), rederivedCore: core(revised), refDetails: refs, periodFrom: period.from, periodTo: period.to });

beforeEach(() => { Pool.mockQuery.mockReset(); });

test('helper correction ties every net-earning removal to one exact immutable observation', () => {
  const first = helperRow(1, '2026-08-03T12:00:00Z', 10000);
  const correction = helperRow(2, '2026-09-05T12:00:00Z', 9000);
  const baseline = helper([first]); const revised = helper([first, correction]);
  const movement = revised.movements[0];
  expect(() => assertDelta(baseline, revised, [{ id: '2', amountCents: 1000, direction: 'debit', effectiveDate: '2026-09-05', movement, deltas: { postedMinor: 0, settledMinor: 0, removedMinor: 1000 } }])).not.toThrow();
  expect(() => assertDelta(baseline, revised, [])).toThrow(/Every new source movement/);
  expect(() => assertDelta(baseline, revised, [{ id: '2', amountCents: 1000, direction: 'debit', effectiveDate: '2026-09-05', movement: { ...movement, statusRemovalsCents: 999 }, deltas: { postedMinor: 0, settledMinor: 0, removedMinor: 1000 } }])).toThrow(/differs from statement evidence/);
});

test('business correction uses actual collection history and rejects unrelated expense changes', () => {
  const first = invoiceRow(1, '2026-08-03T12:00:00Z', '0');
  const correction = invoiceRow(2, '2026-09-05T12:00:00Z', '100');
  const baseline = business([first]); const revised = business([first, correction]);
  const ref = { id: '2', amountCents: 10000, direction: 'debit', effectiveDate: '2026-09-05', movement: revised.receivables.movements[0], deltas: { invoicedMinor: 0, collectedOrAdjustedMinor: 10000, cancelledMinor: 0 } };
  expect(() => assertDelta(baseline, revised, [ref])).not.toThrow();
  expect(() => assertDelta(baseline, { ...revised, payables: { expenses: [], expenseTotalCents: 1 } }, [ref])).toThrow(/Expense changes/);
  expect(() => assertDelta({ ...baseline, receivables: { ...baseline.receivables, movements: undefined } }, revised, [ref])).toThrow(/complete immutable source history/);
});

test('a referenced helper source update is scope-checked and uses observation posting time', async () => {
  const first = helperRow(1, '2026-08-03T12:00:00Z', 10000);
  const correction = helperRow(2, '2026-09-05T12:00:00Z', 9000);
  const db = { query: jest.fn().mockResolvedValueOnce({ rows: [correction] }).mockResolvedValueOnce({ rows: [first, correction] }) };
  const ref = await fetchSettlementCompensatingRef(db, 'helper_earnings', helperId, 'USD', '2');
  expect(ref).toMatchObject({ id: '2', amountCents: 1000, direction: 'debit', effectiveDate: '2026-09-05', sourceEffectiveDate: first.source.completed_at });
  await expect(fetchSettlementCompensatingRef({ query: jest.fn().mockResolvedValue({ rows: [correction] }) }, 'helper_earnings', 'foreign', 'USD', '2')).rejects.toMatchObject({ code: 'statement_amendment_transaction_scope_mismatch' });
});

test('settlement amendments cannot bypass exact next-period continuity with restate-forward', async () => {
  Pool.mockQuery.mockResolvedValueOnce({ rows: [{ id: 'next', period_from: '2026-10-01', period_to: '2026-10-31', document: { openingPayableCents: 10000 } }] })
    .mockResolvedValueOnce({ rows: [] });
  await expect(checkContinuity({ original: { kind: 'settlement', product: 'helper_earnings', accountUuid: helperId, currency_code: 'USD', period_to: '2026-09-30' }, revisedClosingMinor: 9000, baselineClosingMinor: 10000, restateForward: true }))
    .rejects.toMatchObject({ code: 'statement_amendment_continuity_blocked' });
});
