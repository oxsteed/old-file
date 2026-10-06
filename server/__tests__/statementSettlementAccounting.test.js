'use strict';

// Synthetic immutable observations. These fixtures never write historical
// timestamps into a database or alter issued/source records.
const history = require('../services/settlementFinancialHistory');
const statements = require('../services/settlementStatementService');
const { normalizeSettlementDocument } = require('../services/settlementStatementPdf');
const { hashDocument } = require('../services/creditStatementService');

const AUG = { from: '2026-08-01', to: '2026-08-31' };
const SEP = { from: '2026-09-01', to: '2026-09-30' };
const now = '2026-10-05T12:00:00.000Z';
const helperId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const businessOptions = period => ({ businessId: 1, currency: 'USD', period, now });
const helperOptions = period => ({ helperId, currency: 'USD', period, now });
const invoice = { id: '11', business_id: 1, status: 'sent', total: '100.00', amount_paid: '0.00',
  currency_code: 'USD', issue_date: '2026-08-04', invoice_number: 'INV-11', client_name: 'Synthetic Client' };
const job = { id: 'job-1', assigned_helper_id: helperId, payout_status: 'earned', status: 'completed',
  completed_at: '2026-08-04T12:00:00Z', paid_at: null, helper_payout_cents: 10000,
  platform_fee_cents: 1500, customer_total_cents: 11500, currency_code: 'USD', title: 'Synthetic job' };
function observation(id, time, changes = {}, { kind = 'business_invoice', operation = id === 1 ? 'insert' : 'update', sourceId } = {}) {
  const source = { ...(kind === 'business_invoice' ? invoice : job), ...changes };
  return { id: String(id), source_kind: kind, source_id: sourceId || String(source.id),
    scope_id: kind === 'business_invoice' ? '1' : helperId, currency_code: source.currency_code,
    operation, recorded_at: time, source };
}
const invObs = (id, time, changes, options) => observation(id, time, changes, options);
const jobObs = (id, time, changes, options = {}) => observation(id, time, changes, { kind: 'helper_job', ...options });

describe('immutable business accounting (R03)', () => {
  test('August closing 100 becomes September opening 100 and real collection 100', () => {
    const rows = [invObs(1, '2026-08-04T12:00:00Z'), invObs(2, '2026-09-05T12:00:00Z', { status: 'paid', amount_paid: '100.00', paid_at: '2026-09-05T12:00:00Z' })];
    const august = history.projectBusiness(rows, businessOptions(AUG));
    const september = history.projectBusiness(rows, businessOptions(SEP));
    expect(august.closingOutstandingCents).toBe(10000);
    expect(august.invoices[0]).toMatchObject({ status: 'sent', paidCents: 0 });
    expect(september).toMatchObject({ openingOutstandingCents: 10000, collectedOrAdjustedCents: 10000, closingOutstandingCents: 0 });
    expect(september.movements[0]).toMatchObject({ sourceHistoryId: '2', recordedAt: '2026-09-05T12:00:00.000Z', collectedOrAdjustedCents: 10000 });
  });
  test('multiple partial payments and a refunded payment retain every actual delta', () => {
    const rows = [invObs(1, '2026-08-04T12:00:00Z'),
      invObs(2, '2026-08-20T12:00:00Z', { status: 'partial', amount_paid: '30.00' }),
      invObs(3, '2026-09-05T12:00:00Z', { status: 'partial', amount_paid: '70.00' }),
      invObs(4, '2026-09-06T12:00:00Z', { status: 'partial', amount_paid: '60.00' }),
      invObs(5, '2026-09-08T12:00:00Z', { status: 'paid', amount_paid: '100.00' })];
    const august = history.projectBusiness(rows, businessOptions(AUG));
    const september = history.projectBusiness(rows, businessOptions(SEP));
    expect(august.closingOutstandingCents).toBe(7000);
    expect(september.openingOutstandingCents).toBe(7000);
    expect(september.movements.map(m => m.collectedOrAdjustedCents)).toEqual([4000, -1000, 4000]);
    expect(september.collectedOrAdjustedCents).toBe(7000);
    expect(september.closingOutstandingCents).toBe(0);
  });
  test('cancellation removes only the outstanding amount on its actual observation date', () => {
    const rows = [invObs(1, '2026-08-04T12:00:00Z'),
      invObs(2, '2026-08-20T12:00:00Z', { status: 'partial', amount_paid: '30.00' }),
      invObs(3, '2026-09-07T12:00:00Z', { status: 'cancelled', amount_paid: '30.00' })];
    expect(history.projectBusiness(rows, businessOptions(AUG)).closingOutstandingCents).toBe(7000);
    expect(history.projectBusiness(rows, businessOptions(SEP))).toMatchObject({ openingOutstandingCents: 7000, cancelledCents: 7000, collectedOrAdjustedCents: 0, closingOutstandingCents: 0 });
  });
  test('backdated paid_at does not silently move a September collection into August', () => {
    const rows = [invObs(1, '2026-08-04T12:00:00Z'), invObs(2, '2026-09-05T12:00:00Z', { status: 'paid', amount_paid: '100.00', paid_at: '2026-08-20T12:00:00Z' })];
    expect(history.projectBusiness(rows, businessOptions(AUG)).collectedOrAdjustedCents).toBe(0);
    const sep = history.projectBusiness(rows, businessOptions(SEP));
    expect(sep.collectedOrAdjustedCents).toBe(10000);
    expect(sep.movements[0].effectiveDate).toBe('2026-08-20T12:00:00Z');
  });
  test('later approved source amount correction posts later and preserves the original position', () => {
    const rows = [invObs(1, '2026-08-04T12:00:00Z'), invObs(2, '2026-09-05T12:00:00Z', { total: '80.00' })];
    expect(history.projectBusiness(rows, businessOptions(AUG)).closingOutstandingCents).toBe(10000);
    expect(history.projectBusiness(rows, businessOptions(SEP))).toMatchObject({ openingOutstandingCents: 10000, invoicedCents: -2000, collectedOrAdjustedCents: 0, closingOutstandingCents: 8000 });
  });
  test('a legacy observation baseline cannot fabricate a pre-baseline balance', () => {
    const rows = [invObs(1, '2026-09-05T12:00:00Z', {}, { operation: 'baseline' })];
    expect(() => history.projectBusiness(rows, businessOptions(AUG))).toThrow(/baseline/);
    expect(() => history.projectBusiness(rows, businessOptions(SEP))).toThrow(/baseline/);
    expect(history.projectBusiness(rows, businessOptions({ from: '2026-09-06', to: '2026-09-30' }))).toMatchObject({ openingOutstandingCents: 10000, closingOutstandingCents: 10000 });
  });
  test('unknown first state, currency reassignment, bad sequence and deleted debt fail closed', () => {
    expect(() => history.projectBusiness([invObs(2, '2026-08-04T12:00:00Z')], businessOptions(AUG))).toThrow(/Incomplete/);
    expect(() => history.projectBusiness([invObs(1, '2026-08-04T12:00:00Z'), invObs(2, '2026-09-05T12:00:00Z', { currency_code: 'EUR' })], businessOptions(SEP))).toThrow(/currency changed/);
    expect(() => history.projectBusiness([invObs(1, '2026-08-04T12:00:00Z'), invObs(1, '2026-08-05T12:00:00Z')], businessOptions(AUG))).toThrow(/Unordered/);
    expect(() => history.projectBusiness([invObs(1, '2026-08-04T12:00:00Z'), invObs(2, '2026-09-05T12:00:00Z', {}, { operation: 'delete' })], businessOptions(SEP))).toThrow(/deleted/);
  });
  test('birth after the closed period is a late posting, not invented historical issuance', () => {
    const rows = [invObs(1, '2026-09-05T12:00:00Z')];
    expect(history.projectBusiness(rows, businessOptions(AUG)).closingOutstandingCents).toBe(0);
    expect(history.projectBusiness(rows, businessOptions(SEP)).invoicedCents).toBe(10000);
  });
});

describe('immutable helper accounting (R04)', () => {
  test('payout transport failure and retry preserve August closing and September opening', () => {
    const rows = [jobObs(1, '2026-08-04T12:00:00Z'), jobObs(2, '2026-09-05T12:00:00Z', { payout_status: 'failed' }), jobObs(3, '2026-09-06T12:00:00Z', { payout_status: 'pending' })];
    expect(history.projectHelper(rows, helperOptions(AUG)).closingPayableCents).toBe(10000);
    const sep = history.projectHelper(rows, helperOptions(SEP));
    expect(sep).toMatchObject({ openingPayableCents: 10000, statusRemovalsCents: 0, closingPayableCents: 10000 });
    expect(sep.buckets.inTransitCents).toBe(10000);
  });
  test('September settlement is dated by immutable observation, with effective paid_at disclosed', () => {
    const rows = [jobObs(1, '2026-08-04T12:00:00Z'), jobObs(2, '2026-09-05T12:00:00Z', { payout_status: 'paid', paid_at: '2026-08-28T12:00:00Z' })];
    expect(history.projectHelper(rows, helperOptions(AUG)).closingPayableCents).toBe(10000);
    const sep = history.projectHelper(rows, helperOptions(SEP));
    expect(sep).toMatchObject({ openingPayableCents: 10000, settledPayoutsCents: 10000, closingPayableCents: 0 });
    expect(sep.settled[0]).toMatchObject({ paidAt: '2026-09-05T12:00:00.000Z', effectiveDate: '2026-08-28T12:00:00Z', sourceHistoryId: '2' });
  });
  test('reversal of a recorded payout restores the amount still owed in the reversal month', () => {
    const rows = [jobObs(1, '2026-08-04T12:00:00Z'), jobObs(2, '2026-08-20T12:00:00Z', { payout_status: 'paid', paid_at: '2026-08-20T12:00:00Z' }), jobObs(3, '2026-09-05T12:00:00Z', { payout_status: 'reversed', paid_at: '2026-08-20T12:00:00Z' })];
    expect(history.projectHelper(rows, helperOptions(AUG)).closingPayableCents).toBe(0);
    expect(history.projectHelper(rows, helperOptions(SEP))).toMatchObject({ openingPayableCents: 0, settledPayoutsCents: -10000, statusRemovalsCents: 0, closingPayableCents: 10000 });
  });
  test('partial then full net-earning reductions are dated in the correction month', () => {
    const rows = [jobObs(1, '2026-08-04T12:00:00Z'), jobObs(2, '2026-09-05T12:00:00Z', { helper_payout_cents: 7000 }), jobObs(3, '2026-09-06T12:00:00Z', { helper_payout_cents: 0 })];
    expect(history.projectHelper(rows, helperOptions(AUG)).closingPayableCents).toBe(10000);
    const sep = history.projectHelper(rows, helperOptions(SEP));
    expect(sep).toMatchObject({ openingPayableCents: 10000, statusRemovalsCents: 10000, closingPayableCents: 0 });
    expect(sep.removed.map(r => r.helperPayoutCents)).toEqual([3000, 7000]);
    expect(sep.removed[0].removedAt).toBe('2026-09-05T12:00:00.000Z');
  });
  test('undated legacy reversal, cancellation and unpriced completed work fail closed', () => {
    expect(() => history.projectHelper([jobObs(1, '2026-08-04T12:00:00Z', { payout_status: 'reversed' })], helperOptions(AUG))).toThrow(/reversal lacks/);
    expect(() => history.projectHelper([jobObs(1, '2026-08-04T12:00:00Z'), jobObs(2, '2026-09-05T12:00:00Z', { payout_status: 'cancelled' })], helperOptions(SEP))).toThrow(/net-amount correction/);
    expect(() => history.projectHelper([jobObs(1, '2026-08-04T12:00:00Z', { helper_payout_cents: null })], helperOptions(AUG))).toThrow(/net amount/);
  });
  test('a future cancellation does not contaminate an earlier historical position', () => {
    const rows = [jobObs(1, '2026-08-04T12:00:00Z'), jobObs(2, '2026-09-05T12:00:00Z', { payout_status: 'cancelled' })];
    expect(history.projectHelper(rows, helperOptions(AUG)).closingPayableCents).toBe(10000);
  });
  test('helper source precision mismatches and paid states with missing dates fail closed', () => {
    expect(() => history.projectHelper([], { ...helperOptions(AUG), currency: 'JPY' })).toThrow(/precision/);
    expect(() => history.projectHelper([jobObs(1, '2026-08-04T12:00:00Z', { payout_status: 'paid' })], helperOptions(AUG))).toThrow(/dated evidence/);
  });
});

describe('boundary, precision and builder regressions (R06, R07)', () => {
  test.each([['USD', '1.23', 123], ['JPY', '100.00', 100], ['BHD', '1.23', 1230], ['BHD', '-1.001', -1001]])('source major amounts use %s precision', (currency, value, expected) => {
    expect(history.majorToMinor(value, currency, 'synthetic amount')).toBe(expected);
  });
  test.each([['JPY', '1.23'], ['USD', '1.001'], ['ZZZ', '1'], ['USD', '90071992547409.92']])('rejects inconsistent/unsupported/unsafe source amounts (%s, %s)', (currency, value) => {
    expect(() => history.majorToMinor(value, currency, 'synthetic amount')).toThrow();
  });
  test.each([['2024-02-01', '2024-02-29', '2024-03-01'], ['2026-09-01', '2026-09-30', '2026-10-01'], ['2026-12-01', '2026-12-31', '2027-01-01']])('includes both boundaries of %s through %s', (from, to, nextDay) => {
    const options = businessOptions({ from, to }); options.now = '2027-02-01T12:00:00Z';
    const rows = [invObs(1, `${from}T00:00:00Z`), invObs(2, `${to}T23:59:59.999Z`, { status: 'partial', amount_paid: '50.00' }), invObs(3, `${nextDay}T00:00:00Z`, { status: 'paid', amount_paid: '100.00' })];
    const result = history.projectBusiness(rows, options);
    expect(result.invoicedCents).toBe(10000); expect(result.collectedOrAdjustedCents).toBe(5000); expect(result.closingOutstandingCents).toBe(5000);
  });
  test('an offset timestamp crossing UTC midnight belongs to the correct UTC month', () => {
    const result = history.projectBusiness([invObs(1, '2026-08-31T20:01:00-04:00')], businessOptions(SEP));
    expect(result.openingOutstandingCents).toBe(0); expect(result.invoicedCents).toBe(10000);
  });
  test.each([['2024-02-01', '2024-02-29', '2024-03-01'], ['2026-09-01', '2026-09-30', '2026-10-01']])('expense SQL uses next-day exclusive boundary for %s', async (from, to, next) => {
    const query = jest.fn(async (sql, args) => {
      if (sql.trim().startsWith('SELECT transaction_timestamp() AS now')) return { rows: [{ now }] };
      if (sql.includes('FROM settlement_statement_documents')) return { rows: [] };
      if (sql.includes('FROM businesses')) return { rows: [{ id: 1, created_at: '2020-01-01', business_name: 'Synthetic Business', currency_code: 'USD' }] };
      if (sql.includes('FROM business_expenses')) {
        expect(args.slice(0, 3)).toEqual([1, from, next]);
        return { rows: [{ id: 1, category: 'materials', description: 'last day', amount_cents: '1234', expense_date: to, statement_currency_code: 'USD', statement_minor_unit_digits: 2 }] };
      }
      return { rows: [] };
    });
    const doc = await statements.buildStatement({ query }, 'owner', { product: 'business', businessId: 1, currencyCode: 'USD', from, to, rederive: true });
    expect(doc.payables.totalExpensesCents).toBe(1234); expect(doc.payables.expenseCount).toBe(1);
  });
  test('missing history table fails closed instead of falling back to mutable balances', async () => {
    await expect(history.readSourceHistory({ query: jest.fn().mockRejectedValue({ code: '42P01' }) }, 'business_invoice', 1, 'USD')).rejects.toMatchObject({ status: 409, code: 'statement_source_history_unavailable' });
  });
  test('PDF removed rows project the actual removal date and omit obsolete derived-collection note', () => {
    const projection = history.projectHelper([jobObs(1, '2026-08-04T12:00:00Z'), jobObs(2, '2026-09-05T12:00:00Z', { helper_payout_cents: 7000 })], helperOptions(SEP));
    const doc = { id: 'fixture', product: 'helper_earnings', kind: 'monthly', accountLabel: 'Synthetic', accountReference: 'Synthetic', ownerName: 'Synthetic', currencyCode: 'USD', period: SEP, generatedAt: now, ...projection };
    doc.contentHash = hashDocument(doc);
    const pdf = normalizeSettlementDocument(doc);
    expect(pdf.sections.find(s => s.titleKey === 'removedSection').rows[0].completed).toBe('2026-09-05T12:00:00.000Z');
    expect(pdf.notes).not.toContain('helperSnapshotNote');
  });
});
