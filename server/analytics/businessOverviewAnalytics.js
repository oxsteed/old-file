'use strict';

const logger = require('../utils/logger');

// Business workspace overview analytics, contract 'business-overview-v1'.
//
// This is the metrics-layer implementation of the business analytics
// overview. The five revenue/expense/job/invoice metrics are registered in
// the governed metrics registry (server/analytics/metricsRegistry.js,
// owner 'business/finance'); the canonical SQL below is the registered
// definition, copied verbatim so the tab cannot drift from the catalog.
//
// Compute functions take the db module (anything with `.query`) as the
// first argument, per registry convention. Each source fails independently
// (logged, zeroed fallback) so a just-created unpublished business with no
// invoices/expenses yet still gets an overview payload.
const CONTRACT = 'business-overview-v1';

// Registered as business_invoice_revenue (monthly, 6-month window).
const INVOICE_REVENUE_SQL = `
  SELECT TO_CHAR(DATE_TRUNC('month', paid_at), 'YYYY-MM') AS month,
         COALESCE(SUM(total), 0)                          AS revenue
  FROM business_invoices
  WHERE business_id = $1
    AND status = 'paid'
    AND paid_at >= NOW() - INTERVAL '6 months'
  GROUP BY 1
  ORDER BY 1
`;

// Registered as business_job_payout_revenue (monthly, primary business only).
const JOB_PAYOUT_REVENUE_SQL = `
  SELECT TO_CHAR(DATE_TRUNC('month', COALESCE(captured_at, released_at)), 'YYYY-MM') AS month,
         COALESCE(SUM(helper_payout), 0) AS revenue
  FROM payments
  WHERE payee_id = $1
    AND status = 'captured'
    AND COALESCE(captured_at, released_at) >= NOW() - INTERVAL '6 months'
  GROUP BY 1
  ORDER BY 1
`;

// Registered as business_expense_total (monthly, 6-month window).
const EXPENSE_SQL = `
  SELECT TO_CHAR(DATE_TRUNC('month', occurred_at::date), 'YYYY-MM') AS month,
         COALESCE(SUM(amount), 0)                                    AS expenses
  FROM expenses
  WHERE business_id = $1
    AND type = 'expense'
    AND occurred_at >= CURRENT_DATE - INTERVAL '6 months'
  GROUP BY 1
  ORDER BY 1
`;

// Registered as business_job_stats_6m (primary business only).
const JOB_STATS_SQL = `
  SELECT COUNT(*)::int                AS jobs_completed,
         COALESCE(AVG(helper_payout), 0) AS avg_job_value,
         COALESCE(MAX(helper_payout), 0) AS max_job_value
  FROM payments
  WHERE payee_id = $1
    AND status = 'captured'
    AND COALESCE(captured_at, released_at) >= NOW() - INTERVAL '6 months'
`;

// Registered as business_invoice_outstanding.
const INVOICE_SUMMARY_SQL = `
  SELECT
    COALESCE(SUM(total - amount_paid) FILTER (WHERE status IN ('sent','overdue')), 0) AS outstanding,
    COALESCE(SUM(total - amount_paid) FILTER (WHERE status = 'overdue'), 0)            AS overdue,
    COUNT(*) FILTER (WHERE status = 'sent')                                            AS sent_count,
    COUNT(*) FILTER (WHERE status = 'overdue')                                         AS overdue_count
  FROM business_invoices
  WHERE business_id = $1
`;

const round2 = (n) => Math.round((parseFloat(n) || 0) * 100) / 100;

function generateLast6Months() {
  const months = [];
  const now = new Date();
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  return months;
}

async function queryOrEmpty(db, sql, params, fallbackRows = []) {
  try {
    return await db.query(sql, params);
  } catch (err) {
    logger.warn('businessOverviewAnalytics source query failed', { err: err.message });
    return { rows: fallbackRows };
  }
}

async function businessOverviewAnalytics(db, { businessId, ownerId, isPrimary }) {
  const [invoiceRevRes, oxsteedRevRes, expenseRes, jobStatsRes, invoiceSummaryRes] = await Promise.all([
    queryOrEmpty(db, INVOICE_REVENUE_SQL, [businessId]),
    isPrimary
      ? queryOrEmpty(db, JOB_PAYOUT_REVENUE_SQL, [ownerId])
      : Promise.resolve({ rows: [] }),
    queryOrEmpty(db, EXPENSE_SQL, [businessId]),
    isPrimary
      ? queryOrEmpty(db, JOB_STATS_SQL, [ownerId], [{ jobs_completed: 0, avg_job_value: 0, max_job_value: 0 }])
      : Promise.resolve({ rows: [{ jobs_completed: 0, avg_job_value: 0, max_job_value: 0 }] }),
    queryOrEmpty(db, INVOICE_SUMMARY_SQL, [businessId],
      [{ outstanding: 0, overdue: 0, sent_count: 0, overdue_count: 0 }]),
  ]);

  const months = generateLast6Months();
  const invoiceByMonth = Object.fromEntries(invoiceRevRes.rows.map((r) => [r.month, parseFloat(r.revenue)]));
  const oxsteedByMonth = Object.fromEntries(oxsteedRevRes.rows.map((r) => [r.month, parseFloat(r.revenue)]));
  const expenseByMonth = Object.fromEntries(expenseRes.rows.map((r) => [r.month, parseFloat(r.expenses)]));

  const monthly = months.map((m) => {
    const revenue = round2((invoiceByMonth[m] || 0) + (oxsteedByMonth[m] || 0));
    const expenses = round2(expenseByMonth[m] || 0);
    return { month: m, revenue, expenses, profit: round2(revenue - expenses) };
  });

  const thisMo = monthly[monthly.length - 1];
  const lastMo = monthly[monthly.length - 2];

  const currentYear = new Date().getFullYear().toString();
  const ytd = monthly
    .filter((m) => m.month.startsWith(currentYear))
    .reduce(
      (acc, m) => ({
        revenue: round2(acc.revenue + m.revenue),
        expenses: round2(acc.expenses + m.expenses),
        profit: round2(acc.profit + m.profit),
      }),
      { revenue: 0, expenses: 0, profit: 0 },
    );

  const jobStats = jobStatsRes.rows[0] || { jobs_completed: 0, avg_job_value: 0, max_job_value: 0 };
  const invSummary = invoiceSummaryRes.rows[0] || {};

  return {
    contract: CONTRACT,
    business_id: businessId,
    monthly,
    mtd: thisMo || { revenue: 0, expenses: 0, profit: 0 },
    last_month: lastMo || { revenue: 0, expenses: 0, profit: 0 },
    ytd,
    invoices: {
      outstanding_total: round2(parseFloat(invSummary.outstanding || 0)),
      overdue_total: round2(parseFloat(invSummary.overdue || 0)),
      sent: parseInt(invSummary.sent_count || 0, 10),
      overdue_count: parseInt(invSummary.overdue_count || 0, 10),
    },
    jobs: {
      completed_6m: parseInt(jobStats.jobs_completed || 0, 10),
      avg_value: round2(parseFloat(jobStats.avg_job_value || 0)),
      max_value: round2(parseFloat(jobStats.max_job_value || 0)),
    },
  };
}

module.exports = {
  CONTRACT,
  INVOICE_REVENUE_SQL,
  JOB_PAYOUT_REVENUE_SQL,
  EXPENSE_SQL,
  JOB_STATS_SQL,
  INVOICE_SUMMARY_SQL,
  businessOverviewAnalytics,
};
