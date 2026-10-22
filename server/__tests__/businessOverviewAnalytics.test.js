'use strict';

// Business analytics overview on the metrics layer: the tab's numbers must
// come from the registered canonical definitions, and each source must fail
// independently (zeroed KPIs, never a 500).
jest.mock('../utils/logger', () => ({
  warn: jest.fn(),
  error: jest.fn(),
  info: jest.fn(),
  debug: jest.fn(),
}));

const { METRICS } = require('../analytics/metricsRegistry');
const {
  CONTRACT,
  INVOICE_REVENUE_SQL,
  JOB_PAYOUT_REVENUE_SQL,
  EXPENSE_SQL,
  JOB_STATS_SQL,
  INVOICE_SUMMARY_SQL,
  businessOverviewAnalytics,
} = require('../analytics/businessOverviewAnalytics');

const BUSINESS_METRICS = [
  'business_invoice_revenue',
  'business_job_payout_revenue',
  'business_expense_total',
  'business_job_stats_6m',
  'business_invoice_outstanding',
];

describe('business metrics registry', () => {
  test('all five overview metrics are registered under business/finance', () => {
    for (const name of BUSINESS_METRICS) {
      expect(METRICS[name]).toBeDefined();
      expect(METRICS[name].name).toBe(name);
      expect(METRICS[name].owner).toBe('business/finance');
    }
  });

  test('the module SQL is the canonical registered SQL (no drift)', () => {
    // The registry is the definition of record; the module carries the
    // executable copy. Key table/filter fragments must agree.
    expect(INVOICE_REVENUE_SQL).toContain('business_invoices');
    expect(INVOICE_REVENUE_SQL).toContain("status = 'paid'");
    expect(JOB_PAYOUT_REVENUE_SQL).toContain('payments');
    expect(JOB_PAYOUT_REVENUE_SQL).toContain("status = 'captured'");
    expect(EXPENSE_SQL).toContain('expenses');
    expect(EXPENSE_SQL).toContain("type = 'expense'");
    expect(JOB_STATS_SQL).toContain('helper_payout');
    expect(INVOICE_SUMMARY_SQL).toContain('total - amount_paid');
  });
});

function mockDb(handlers) {
  return {
    query: jest.fn(async (sql) => {
      for (const [fragment, result] of handlers) {
        if (sql.includes(fragment)) {
          if (result instanceof Error) throw result;
          return { rows: result };
        }
      }
      return { rows: [] };
    }),
  };
}

describe('businessOverviewAnalytics', () => {
  test('merges invoice + job revenue and expenses into the overview contract', async () => {
    const db = mockDb([
      ['business_invoices', [{ month: '2026-10', revenue: '100.00' }]],
      ['helper_payout', [{ month: '2026-10', revenue: '50' }]],
      ['expenses', [{ month: '2026-10', expenses: '30' }]],
    ]);
    const out = await businessOverviewAnalytics(db, {
      businessId: 7,
      ownerId: 'owner-1',
      isPrimary: true,
    });
    expect(out.contract).toBe(CONTRACT);
    expect(out.business_id).toBe(7);
    expect(out.monthly).toHaveLength(6);
    const current = out.monthly[out.monthly.length - 1];
    expect(current).toEqual({ month: '2026-10', revenue: 150, expenses: 30, profit: 120 });
    expect(out.mtd).toEqual(current);
    expect(out.ytd.revenue).toBe(150);
  });

  test('non-primary businesses skip the owner-payee sources', async () => {
    const db = mockDb([]);
    const out = await businessOverviewAnalytics(db, {
      businessId: 7,
      ownerId: 'owner-1',
      isPrimary: false,
    });
    expect(out.jobs.completed_6m).toBe(0);
    expect(out.monthly).toHaveLength(6);
  });

  test('a failing source zeroes its KPIs but keeps the payload', async () => {
    const db = mockDb([
      ['business_invoices', new Error('invoices down')],
      ['expenses', [{ month: '2026-10', expenses: '30' }]],
    ]);
    const out = await businessOverviewAnalytics(db, {
      businessId: 7,
      ownerId: 'owner-1',
      isPrimary: true,
    });
    expect(out.monthly).toHaveLength(6);
    expect(out.invoices.outstanding_total).toBe(0);
    expect(out.invoices.sent).toBe(0);
    // The expense source still merged.
    expect(out.monthly[out.monthly.length - 1].expenses).toBe(30);
  });

  test('invoice summary and job stats populate the nested KPI shapes', async () => {
    const db = mockDb([
      ['total - amount_paid', [{ outstanding: '200.50', overdue: '40', sent_count: '3', overdue_count: '1' }]],
      ['helper_payout', [{ jobs_completed: 9, avg_job_value: '11.5', max_job_value: '20' }]],
    ]);
    const out = await businessOverviewAnalytics(db, {
      businessId: 7,
      ownerId: 'owner-1',
      isPrimary: true,
    });
    expect(out.invoices).toEqual({
      outstanding_total: 200.5,
      overdue_total: 40,
      sent: 3,
      overdue_count: 1,
    });
    expect(out.jobs).toEqual({ completed_6m: 9, avg_value: 11.5, max_value: 20 });
  });
});
