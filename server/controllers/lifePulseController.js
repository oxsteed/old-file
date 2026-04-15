'use strict';
const db = require('../db');
const { DEFAULTS: SETTINGS_DEFAULTS } = require('./pulseScoreSettingsController');

// ── constants ────────────────────────────────────────────────────────────────

const WINDOW_DAYS = {
  '1w':  7,   '2w': 14,  '1m':  30,  '3m':  90,
  '6m': 180,  '1y': 365, '5y': 1825, '10y': 3650,
};

const WINDOW_LABELS = {
  '1w': '1 Week',   '2w': '2 Weeks',  '1m': '1 Month',  '3m': '3 Months',
  '6m': '6 Months', '1y': '1 Year',   '5y': '5 Years',  '10y': '10 Years',
};

// ── scoring helpers ───────────────────────────────────────────────────────────

/**
 * Coverage score (40 pts max):
 * How well projected income covers projected obligations (fixed + sinking funds).
 * ratio ≥ 1.5 → 100 | ratio = 1.0 → 70 | ratio = 0 → 0
 */
function scoreCoverage(coverageRatio) {
  if (coverageRatio === null || coverageRatio === undefined) return 50; // no obligations yet
  if (coverageRatio >= 1.5) return 100;
  if (coverageRatio >= 1.0) return 70 + ((coverageRatio - 1.0) / 0.5) * 30;
  return Math.max(0, coverageRatio * 70);
}

/**
 * Buffer score (25 pts max):
 * Financial runway — based on cumulative 90-day net as a savings proxy.
 * runway ≥ 6 mo → 100 | 3 mo → 70 | 1 mo → 40 | 0 → 10 (non-zero so new users aren't crushed)
 */
function scoreBuffer(runwayMonths) {
  if (runwayMonths === null) return 50;
  if (runwayMonths >= 6)   return 100;
  if (runwayMonths >= 3)   return 70  + ((runwayMonths - 3) / 3) * 30;
  if (runwayMonths >= 1)   return 40  + ((runwayMonths - 1) / 2) * 30;
  if (runwayMonths > 0)    return runwayMonths * 40;
  return 10;
}

/**
 * Reliability score (20 pts max):
 * Compares last-30d daily avg income against prior-60d daily avg.
 * No drop → 95 | small drop (< 15%) → 82 | moderate (15–30%) → 65 | large (30–50%) → 45 | severe (> 50%) → 20
 */
function scoreReliability(dropPct) {
  if (dropPct > 0.50) return 20;
  if (dropPct > 0.30) return 45;
  if (dropPct > 0.15) return 65;
  if (dropPct > 0.00) return 82;
  return 95;
}

/**
 * Obligations score (15 pts max):
 * Average funding % across active planned needs that have an estimated cost.
 * No costy needs → 80 (neutral).
 */
function scoreObligations(needs) {
  const funded = needs.filter(n => parseFloat(n.estimated_cost || 0) > 0);
  if (funded.length === 0) return 80;
  const avgPct = funded.reduce((sum, n) => {
    const cost     = parseFloat(n.estimated_cost);
    const reserved = parseFloat(n.reserved_amount || 0);
    return sum + Math.min(100, (reserved / cost) * 100);
  }, 0) / funded.length;
  return Math.round(avgPct);
}

// ── main handler ──────────────────────────────────────────────────────────────

exports.getLifePulse = async (req, res) => {
  try {
    const userId    = req.user.id;
    const windowKey = req.query.window || '1m';
    const windowDays = WINDOW_DAYS[windowKey];

    if (!windowDays) {
      return res.status(400).json({
        error: `Invalid window. Valid values: ${Object.keys(WINDOW_DAYS).join(', ')}`,
      });
    }

    // ── fetch user settings first (cheap single-row lookup) ───────────────
    const settingsRes = await db.query(
      'SELECT * FROM pulse_score_settings WHERE user_id = $1', [userId]
    );
    // cfg(key): true if the user has not explicitly disabled this source.
    // Missing row → all defaults (TRUE). Explicit false → excluded.
    const _s = { ...SETTINGS_DEFAULTS, ...(settingsRes.rows[0] || {}) };
    const cfg = (key) => _s[key] !== false;

    // ── parallel queries ───────────────────────────────────────────────────
    const [
      baselineRes, reliabilityRes, oxsteedRes, needsRes, recurringRes, taskRecurringRes,
      invoiceIncomeRes, pendingInvoicesRes, taxObligationsRes, predictedJobRes,
      toolRentalRes, debtObligRes,
    ] = await Promise.all([

      // 1. 90-day one-time income and expense totals (non-recurring entries only)
      db.query(`
        SELECT
          COALESCE(SUM(amount) FILTER (WHERE type = 'income'),  0) AS income_90d,
          COALESCE(SUM(amount) FILTER (WHERE type = 'expense'), 0) AS expense_90d
        FROM expenses
        WHERE user_id = $1
          AND occurred_at >= CURRENT_DATE - INTERVAL '90 days'
          AND (is_recurring IS NOT TRUE)
      `, [userId]),

      // 2. Reliability: last 30d vs prior 60d (days 31–90) income — all entries
      db.query(`
        SELECT
          COALESCE(SUM(amount) FILTER (
            WHERE type = 'income'
              AND occurred_at >= CURRENT_DATE - INTERVAL '30 days'
          ), 0) AS income_last30,
          COALESCE(SUM(amount) FILTER (
            WHERE type = 'income'
              AND occurred_at <  CURRENT_DATE - INTERVAL '30 days'
              AND occurred_at >= CURRENT_DATE - INTERVAL '90 days'
          ), 0) AS income_prior60
        FROM expenses
        WHERE user_id = $1
          AND occurred_at >= CURRENT_DATE - INTERVAL '90 days'
      `, [userId]),

      // 3. OxSteed job income settled in last 90 days (helper_payout from payments)
      //    Added separately so it doesn't double-count if the user already logs job
      //    income in their expenses table (but since payments are Stripe transactions,
      //    most users won't log them again manually).
      db.query(`
        SELECT COALESCE(SUM(helper_payout), 0) AS oxsteed_income_90d
        FROM payments
        WHERE payee_id = $1
          AND status IN ('captured', 'released')
          AND COALESCE(captured_at, released_at) >= NOW() - INTERVAL '90 days'
      `, [userId]),

      // 4. Active planned needs (same set the old /projection used)
      db.query(`
        SELECT
          id, title, category, status, due_date,
          estimated_cost, reserved_amount, lead_time_days,
          (due_date - CURRENT_DATE) AS days_until_due
        FROM planned_needs
        WHERE user_id = $1
          AND status IN ('planned', 'funding', 'activating_soon')
          AND due_date >= CURRENT_DATE
        ORDER BY due_date ASC
      `, [userId]),

      // 5. Recurring expenses/income — deduplicated to the most recent entry per
      //    (type, category, description, frequency), then normalised to a monthly
      //    equivalent. Including description prevents two distinct recurring entries
      //    in the same category (e.g. Netflix + Spotify both in "Subscriptions")
      //    from being collapsed into one. Entries with the same description are
      //    still deduplicated so re-logging the same pattern doesn't double-count.
      //    Only active entries (within optional start/end date range) are included.
      db.query(`
        SELECT
          COALESCE(SUM(CASE WHEN type = 'income'  THEN monthly_eq ELSE 0 END), 0) AS recurring_income_monthly,
          COALESCE(SUM(CASE WHEN type = 'expense' THEN monthly_eq ELSE 0 END), 0) AS recurring_expense_monthly
        FROM (
          SELECT DISTINCT ON (type, category, description, frequency)
            type,
            CASE frequency
              WHEN 'daily'      THEN amount * 30
              WHEN 'weekly'     THEN amount * (30.0 / 7)
              WHEN 'bi_weekly'  THEN amount * (30.0 / 14)
              WHEN 'monthly'    THEN amount
              WHEN 'quarterly'  THEN amount / 3.0
              WHEN 'yearly'     THEN amount / 12.0
              ELSE                   amount
            END AS monthly_eq
          FROM expenses
          WHERE user_id = $1
            AND is_recurring = TRUE
            AND frequency IS NOT NULL
            AND frequency <> 'one_time'
            AND (recurring_start_date IS NULL OR recurring_start_date <= CURRENT_DATE)
            AND (recurring_end_date   IS NULL OR recurring_end_date   >= CURRENT_DATE)
          ORDER BY type, category, description, frequency, occurred_at DESC
        ) r
      `, [userId]),

      // 6. Recurring home-task costs — split by section so each plan type can be
      //    toggled independently via pulse_score_settings.
      //    Sections: 'home_maintenance', 'car_care', 'personal_care'
      db.query(`
        SELECT
          COALESCE(SUM(monthly_eq) FILTER (WHERE section = 'home_maintenance'), 0) AS home_monthly,
          COALESCE(SUM(monthly_eq) FILTER (WHERE section = 'car_care'),         0) AS car_monthly,
          COALESCE(SUM(monthly_eq) FILTER (WHERE section = 'personal_care'),    0) AS personal_monthly
        FROM (
          SELECT DISTINCT ON (section, title, frequency)
            section,
            CASE frequency
              WHEN 'daily'      THEN estimated_cost * 30
              WHEN 'weekly'     THEN estimated_cost * (30.0 / 7)
              WHEN 'bi_weekly'  THEN estimated_cost * (30.0 / 14)
              WHEN 'monthly'    THEN estimated_cost
              WHEN 'quarterly'  THEN estimated_cost / 3.0
              WHEN 'yearly'     THEN estimated_cost / 12.0
              ELSE                   0
            END AS monthly_eq
          FROM home_tasks
          WHERE user_id = $1
            AND is_recurring = TRUE
            AND section IN ('home_maintenance', 'car_care', 'personal_care')
            AND estimated_cost IS NOT NULL AND estimated_cost > 0
            AND frequency IS NOT NULL AND frequency <> 'one_time'
            AND (recurring_start_date IS NULL OR recurring_start_date <= CURRENT_DATE)
            AND (recurring_end_date   IS NULL OR recurring_end_date   >= CURRENT_DATE)
          ORDER BY section, title, frequency, created_at DESC
        ) t
      `, [userId]),

      // 7. Paid invoice income in last 90 days (across all businesses)
      db.query(`
        SELECT COALESCE(SUM(bi.total), 0) AS invoice_income_90d
        FROM business_invoices bi
        JOIN businesses b ON b.id = bi.business_id
        WHERE b.user_id = $1
          AND bi.status = 'paid'
          AND bi.paid_at >= NOW() - INTERVAL '90 days'
      `, [userId]),

      // 8. Outstanding invoices (sent/overdue) within this window — expected income
      db.query(`
        SELECT COALESCE(SUM(bi.total - bi.amount_paid), 0) AS pending_invoice_total,
               COUNT(*) AS pending_count
        FROM business_invoices bi
        JOIN businesses b ON b.id = bi.business_id
        WHERE b.user_id = $1
          AND bi.status IN ('sent','overdue')
          AND (bi.due_date IS NULL OR bi.due_date <= CURRENT_DATE + ($2 || ' days')::INTERVAL)
      `, [userId, windowDays]),

      // 9. Upcoming tax estimates due within this window
      db.query(`
        SELECT COALESCE(SUM(te.estimated_tax - te.paid_amount), 0) AS upcoming_tax_due,
               MIN(te.due_date)                                      AS nearest_tax_due,
               COUNT(*)                                              AS tax_estimate_count
        FROM business_tax_estimates te
        WHERE te.user_id = $1
          AND te.status = 'pending'
          AND te.due_date <= CURRENT_DATE + ($2 || ' days')::INTERVAL
          AND te.due_date >= CURRENT_DATE
      `, [userId, windowDays]),

      // 10. Predicted income: authorized escrow payments the user has signed up for
      //     but not yet completed (payment held, will be released on job completion).
      //     These are future values — known, committed, but not yet realized.
      db.query(`
        SELECT COALESCE(SUM(helper_payout), 0) AS predicted_job_income
        FROM payments
        WHERE payee_id = $1
          AND status = 'authorized'
      `, [userId]),

      // 11. Tool rental income: manual income entries the user has logged under
      //     tool / equipment / rental categories in the last 90 days.
      db.query(`
        SELECT COALESCE(SUM(amount), 0) AS tool_rental_income_90d
        FROM expenses
        WHERE user_id = $1
          AND type = 'income'
          AND (
            LOWER(category) LIKE '%tool%'
            OR LOWER(category) LIKE '%equipment%'
            OR LOWER(category) LIKE '%rental%'
          )
          AND occurred_at >= CURRENT_DATE - INTERVAL '90 days'
      `, [userId]),

      // 12. Monthly debt obligations: recurring expenses in debt / loan / mortgage /
      //     credit categories — deduplicated the same way as other recurring expenses.
      db.query(`
        SELECT COALESCE(SUM(monthly_eq), 0) AS debt_monthly
        FROM (
          SELECT DISTINCT ON (category, description, frequency)
            CASE frequency
              WHEN 'daily'      THEN amount * 30
              WHEN 'weekly'     THEN amount * (30.0 / 7)
              WHEN 'bi_weekly'  THEN amount * (30.0 / 14)
              WHEN 'monthly'    THEN amount
              WHEN 'quarterly'  THEN amount / 3.0
              WHEN 'yearly'     THEN amount / 12.0
              ELSE                   amount
            END AS monthly_eq
          FROM expenses
          WHERE user_id = $1
            AND type = 'expense'
            AND is_recurring = TRUE
            AND frequency IS NOT NULL AND frequency <> 'one_time'
            AND (
              LOWER(category) LIKE '%loan%'
              OR LOWER(category) LIKE '%debt%'
              OR LOWER(category) LIKE '%mortgage%'
              OR LOWER(category) LIKE '%credit%'
            )
            AND (recurring_start_date IS NULL OR recurring_start_date <= CURRENT_DATE)
            AND (recurring_end_date   IS NULL OR recurring_end_date   >= CURRENT_DATE)
          ORDER BY category, description, frequency, occurred_at DESC
        ) d
      `, [userId]),
    ]);

    const baseline          = baselineRes.rows[0];
    const reliability       = reliabilityRes.rows[0];
    const oxsteed           = oxsteedRes.rows[0];
    const rawNeeds          = needsRes.rows;
    const recurringRow      = recurringRes.rows[0];
    const taskRow           = taskRecurringRes.rows[0];
    const invoiceIncomeRow  = invoiceIncomeRes.rows[0];
    const pendingInvRow     = pendingInvoicesRes.rows[0];
    const taxObligRow       = taxObligationsRes.rows[0];
    const predictedJobRow   = predictedJobRes.rows[0];
    const toolRentalRow     = toolRentalRes.rows[0];
    const debtObligRow      = debtObligRes.rows[0];

    // ── Raw values (pre-settings) ───────────────────────────────────────────
    const invoiceIncome90d_raw    = parseFloat(invoiceIncomeRow.invoice_income_90d);
    const pendingInvoiceTotal_raw = parseFloat(pendingInvRow.pending_invoice_total);
    const pendingInvoiceCount     = parseInt(pendingInvRow.pending_count || 0);
    const upcomingTaxDue_raw      = parseFloat(taxObligRow.upcoming_tax_due || 0);
    const taxEstimateCount        = parseInt(taxObligRow.tax_estimate_count || 0);
    const predictedJobIncome_raw  = parseFloat(predictedJobRow.predicted_job_income || 0);
    const toolRentalIncome90d_raw = parseFloat(toolRentalRow.tool_rental_income_90d || 0);
    const debtMonthly_raw         = parseFloat(debtObligRow.debt_monthly || 0);

    // ── Apply settings gates ────────────────────────────────────────────────
    // Each source is zeroed out if the user has disabled it.
    const invoiceIncome90d    = cfg('include_business_pl')        ? invoiceIncome90d_raw    : 0;
    const pendingInvoiceTotal = cfg('include_pending_invoices')   ? pendingInvoiceTotal_raw : 0;
    const upcomingTaxDue      = cfg('include_tax_obligations')    ? upcomingTaxDue_raw      : 0;
    const predictedJobIncome  = cfg('include_predicted_jobs')     ? predictedJobIncome_raw  : 0;
    const toolRentalIncome90d = cfg('include_tool_rentals')       ? toolRentalIncome90d_raw : 0;

    // Predicted future income (committed but not yet realized)
    const predictedInvoiceIncome = round2(pendingInvoiceTotal * 0.80);

    // ── 1. Daily averages (settings-gated) ─────────────────────────────────
    const income90d_raw  = parseFloat(baseline.income_90d);
    const expense90d_raw = parseFloat(baseline.expense_90d);
    const income90d  = cfg('include_manual_income')   ? income90d_raw  : 0;
    const expense90d = cfg('include_manual_expenses') ? expense90d_raw : 0;

    const oxsteedIncome = cfg('include_oxsteed_income') ? parseFloat(oxsteed.oxsteed_income_90d) : 0;

    // Recurring income/expense — gated per direction
    const recurringIncomeMonthly_raw  = parseFloat(recurringRow.recurring_income_monthly);
    const recurringExpenseMonthly_raw = parseFloat(recurringRow.recurring_expense_monthly);

    const recurringIncomeMonthly  = cfg('include_recurring_income')   ? recurringIncomeMonthly_raw  : 0;
    // Recurring expenses: include the full recurring amount, but subtract debt portion
    // if debt is disabled so it isn't double-excluded (debt is a subset of recurring).
    let recurringExpenseMonthly = cfg('include_recurring_expenses') ? recurringExpenseMonthly_raw : 0;
    if (cfg('include_recurring_expenses') && !cfg('include_debt_obligations')) {
      // User wants recurring expenses but not the debt subset → subtract it
      recurringExpenseMonthly = Math.max(0, recurringExpenseMonthly - debtMonthly_raw);
    }
    if (!cfg('include_recurring_expenses') && cfg('include_debt_obligations')) {
      // User excluded recurring but kept debt → add only the debt portion back
      recurringExpenseMonthly = debtMonthly_raw;
    }

    // Home task costs — split by section so each plan type can be toggled
    const taskExpMonthly_home     = cfg('include_home_maintenance') ? parseFloat(taskRow.home_monthly     || 0) : 0;
    const taskExpMonthly_car      = cfg('include_car_care')         ? parseFloat(taskRow.car_monthly      || 0) : 0;
    const taskExpMonthly_personal = cfg('include_personal_care')    ? parseFloat(taskRow.personal_monthly || 0) : 0;
    const taskExpenseMonthly = taskExpMonthly_home + taskExpMonthly_car + taskExpMonthly_personal;

    const totalIncome90d  = income90d + oxsteedIncome + invoiceIncome90d + toolRentalIncome90d;
    const avgDailyIncome  = (totalIncome90d / 90) + (recurringIncomeMonthly  / 30);
    const avgDailyExpense = (expense90d / 90) + (recurringExpenseMonthly / 30) + (taskExpenseMonthly / 30);

    // ── 2. Window projections ───────────────────────────────────────────────
    const projectedIncome   = round2(avgDailyIncome  * windowDays);
    const projectedExpenses = round2(avgDailyExpense * windowDays);

    // ── 3. Sinking fund math per need ───────────────────────────────────────
    // Formula (same as the existing UI note): (cost − reserved) ÷ days remaining × window_days
    let totalSinkingFund    = 0;
    let autoPublishingCount = 0;

    const needs = rawNeeds.map(need => {
      const daysUntilDue = Math.max(0, parseInt(need.days_until_due || 0));
      const cost         = parseFloat(need.estimated_cost || 0);
      const reserved     = parseFloat(need.reserved_amount || 0);
      const remaining    = Math.max(0, cost - reserved);
      const daysToFund   = Math.max(daysUntilDue, 1);
      const dailyContrib = remaining / daysToFund;
      // Only count the portion of the sinking fund that falls within this horizon.
      // Use daysToFund (floored to 1) so needs due today aren't zeroed out —
      // a need due today has its full remaining balance due immediately.
      const daysInWindow = Math.min(windowDays, daysToFund);
      const windowCost   = dailyContrib * daysInWindow;
      const monthlyContrib = dailyContrib * 30;

      totalSinkingFund += windowCost;

      const activationDays   = daysUntilDue - parseInt(need.lead_time_days || 7);
      const isActivatingSoon = activationDays <= windowDays;
      if (isActivatingSoon) autoPublishingCount++;

      return {
        id:                     need.id,
        title:                  need.title,
        category:               need.category,
        status:                 need.status,
        due_date:               need.due_date,
        estimated_cost:         cost,
        reserved_amount:        reserved,
        days_until_due:         daysUntilDue,
        sinking_fund_per_month: round2(monthlyContrib),
        window_cost:            round2(windowCost),
        funding_pct:            cost > 0 ? Math.min(100, Math.round((reserved / cost) * 100)) : 0,
        activates_in_days:      activationDays,
        is_activating_soon:     isActivatingSoon,
      };
    });

    // If planned needs are disabled, treat sinking fund obligations as zero.
    const sinkingFundForWindow = cfg('include_planned_needs') ? round2(totalSinkingFund) : 0;

    // ── 4. Net, coverage, runway ────────────────────────────────────────────
    // Present-value model:
    //   past    = projectedIncome (historical baseline extrapolated over the window)
    //   future  = predictedJobIncome (authorized escrow jobs signed up for)
    //           + predictedInvoiceIncome (pending invoices at 80% confidence)
    //   present = past + future — the projected reality if everything holds
    //
    // This means a user earning $200/mo who signs up for a $150 job sees a
    // present-value income of $350 for the window, not just $200.
    const totalPredictedIncome  = round2(predictedJobIncome + predictedInvoiceIncome);
    const presentValueIncome    = round2(projectedIncome + totalPredictedIncome);

    const totalObligations = projectedExpenses + sinkingFundForWindow + upcomingTaxDue;
    const netAvailable     = round2(presentValueIncome - totalObligations);
    const coverageRatio    = totalObligations > 0
      ? round2(presentValueIncome / totalObligations)
      : null;

    // Runway: proxy from 90-day cumulative net (estimating built-up buffer).
    // Not a live savings balance, but a strong signal of recent cash trajectory.
    // Include recurring income/expense over the same 90-day window so the
    // numerator is consistent with monthlyBurn (which uses avgDailyExpense,
    // already incorporating recurring). Without this, a user whose salary is
    // a recurring entry would show estimatedBuffer ≈ 0 while monthlyBurn
    // correctly counts their expenses, collapsing runwayMonths to zero.
    const estimatedBuffer = (totalIncome90d + recurringIncomeMonthly * 3)
                          - (expense90d     + recurringExpenseMonthly * 3);
    const monthlyBurn     = avgDailyExpense * 30;
    const runwayMonths    = monthlyBurn > 0
      ? round1(Math.max(0, estimatedBuffer) / monthlyBurn)
      : null;

    // ── 5. Income reliability ───────────────────────────────────────────────
    const last30     = parseFloat(reliability.income_last30);
    const prior60    = parseFloat(reliability.income_prior60);
    const prior60DailyAvg = prior60 / 60;
    const last30DailyAvg  = last30  / 30;

    // Drop percentage: how much has daily income fallen compared to the prior period?
    const incomeDropPct = prior60DailyAvg > 0
      ? Math.max(0, (prior60DailyAvg - last30DailyAvg) / prior60DailyAvg)
      : 0;
    const incomeReliability = round2(Math.max(0, 1 - incomeDropPct));

    // ── 6. Shortfall warnings ───────────────────────────────────────────────
    const netDailySurplus = avgDailyIncome - avgDailyExpense;
    const shortfallWarnings = [];

    for (const need of rawNeeds) {
      const daysUntilDue = Math.max(0, parseInt(need.days_until_due || 0));
      const cost         = parseFloat(need.estimated_cost || 0);
      const reserved     = parseFloat(need.reserved_amount || 0);
      if (cost <= 0) continue;

      // Estimate how much the user will have saved by the due date at current pace
      const projectedSavingsUntilDue = netDailySurplus * daysUntilDue;
      const projectedAvailable       = Math.max(0, reserved + projectedSavingsUntilDue);
      const shortfall                = Math.max(0, cost - projectedAvailable);

      if (shortfall > 0) {
        const dueDateStr = need.due_date instanceof Date
          ? need.due_date.toISOString().split('T')[0]
          : String(need.due_date).split('T')[0];

        shortfallWarnings.push({
          need_id:             need.id,
          title:               need.title,
          due_date:            dueDateStr,
          days_until_due:      daysUntilDue,
          estimated_cost:      cost,
          reserved_amount:     reserved,
          projected_available: round2(projectedAvailable),
          shortfall:           round2(shortfall),
        });
      }
    }

    // ── 7. Plain-language alerts ────────────────────────────────────────────
    const alerts = [];

    // Coverage alert
    if (coverageRatio !== null && coverageRatio < 1.0) {
      const windowLabel = WINDOW_LABELS[windowKey].toLowerCase();
      alerts.push(
        `Projected income won't cover all obligations over the next ${windowLabel}.`
      );
    }

    // Reliability alert
    if (incomeDropPct > 0.15) {
      alerts.push(
        `Income dropped ${Math.round(incomeDropPct * 100)}% last month — reliability score reduced.`
      );
    }

    // Shortfall alert per need (only those due within 2× the window so alerts stay relevant)
    const alertHorizon = windowDays * 2;
    for (const w of shortfallWarnings) {
      if (w.days_until_due > alertHorizon) continue;
      const monthName = new Date(w.due_date + 'T00:00:00').toLocaleString('en-US', { month: 'long' });
      const shortfallFmt = w.shortfall.toLocaleString('en-US', { maximumFractionDigits: 0 });
      alerts.push(`You'll be short by $${shortfallFmt} for your ${monthName} ${w.title}.`);
    }

    // Runway alert
    if (runwayMonths !== null && runwayMonths < 1 && monthlyBurn > 0) {
      alerts.push('Less than 1 month of financial runway — consider reducing discretionary spending.');
    }

    // Business alerts
    if (upcomingTaxDue > 0 && taxEstimateCount > 0) {
      const taxFmt    = upcomingTaxDue.toLocaleString('en-US', { maximumFractionDigits: 0 });
      const dueDateFmt = taxObligRow.nearest_tax_due
        ? new Date(taxObligRow.nearest_tax_due + 'T00:00:00')
            .toLocaleDateString('en-US', { month: 'long', day: 'numeric' })
        : 'soon';
      alerts.push(
        `Estimated tax payment of $${taxFmt} is due ${dueDateFmt} — included in your obligations.`
      );
    }

    if (pendingInvoiceCount > 0) {
      const pendingFmt         = pendingInvoiceTotal.toLocaleString('en-US', { maximumFractionDigits: 0 });
      const pendingCountedFmt  = predictedInvoiceIncome.toLocaleString('en-US', { maximumFractionDigits: 0 });
      alerts.push(
        `$${pendingFmt} in outstanding invoices — $${pendingCountedFmt} counted as predicted income in your score.`
      );
    }

    // ── 8. Compute overall pulse score ─────────────────────────────────────
    const cScore = scoreCoverage(coverageRatio);
    const bScore = scoreBuffer(runwayMonths);
    const rScore = scoreReliability(incomeDropPct);
    const oScore = scoreObligations(rawNeeds);

    // Equal weight: each dimension contributes 25% so no single signal dominates.
    const pulseScore = Math.max(0, Math.min(100, Math.round(
      cScore * 0.25 +
      bScore * 0.25 +
      rScore * 0.25 +
      oScore * 0.25
    )));

    // ── response ────────────────────────────────────────────────────────────
    res.json({
      window:      windowKey,
      window_days: windowDays,

      // Score
      pulse_score: pulseScore,
      score_breakdown: {
        coverage:     Math.round(cScore),
        buffer:       Math.round(bScore),
        reliability:  Math.round(rScore),
        obligations:  oScore,
      },

      // Averages (useful for debugging / display)
      avg_daily_income:  round2(avgDailyIncome),
      avg_daily_expense: round2(avgDailyExpense),
      oxsteed_income_90d:    round2(oxsteedIncome),
      tool_rental_income_90d: round2(toolRentalIncome90d),
      invoice_income_90d:    round2(invoiceIncome90d),
      pending_invoice_total: round2(pendingInvoiceTotal),
      pending_invoice_count: pendingInvoiceCount,
      upcoming_tax_due:      round2(upcomingTaxDue),

      // Past / predicted / present-value income breakdown.
      // past_income      = historical baseline projected over the window.
      // predicted_income = future values known today (authorized jobs + 80% of pending invoices).
      // present_value_income = past + predicted: the projected reality for this window.
      past_income:           projectedIncome,
      predicted_income: {
        total:            totalPredictedIncome,
        authorized_jobs:  round2(predictedJobIncome),
        pending_invoices: round2(predictedInvoiceIncome),
      },
      present_value_income:  presentValueIncome,

      // Settings: what is currently active, so the UI can render the toggle list.
      settings: Object.fromEntries(
        Object.keys(SETTINGS_DEFAULTS).map(k => [k, cfg(k)])
      ),
      // Per-source contribution breakdown for transparency UI.
      sources: {
        manual_income_90d:        round2(income90d),
        manual_expense_90d:       round2(expense90d),
        recurring_income_monthly: round2(recurringIncomeMonthly),
        recurring_expense_monthly: round2(recurringExpenseMonthly),
        oxsteed_income_90d:       round2(oxsteedIncome),
        tool_rental_income_90d:   round2(toolRentalIncome90d),
        invoice_income_90d:       round2(invoiceIncome90d),
        predicted_jobs:           round2(predictedJobIncome),
        predicted_invoices:       round2(predictedInvoiceIncome),
        tax_obligations_window:   round2(upcomingTaxDue),
        home_maintenance_monthly: round2(taskExpMonthly_home),
        car_care_monthly:         round2(taskExpMonthly_car),
        personal_care_monthly:    round2(taskExpMonthly_personal),
        debt_monthly:             round2(cfg('include_debt_obligations') ? debtMonthly_raw : 0),
        sinking_fund_window:      sinkingFundForWindow,
      },

      // Horizon-adjusted projections (backward-compat with old /projection fields)
      projected_income:         projectedIncome,
      projected_fixed_expenses: projectedExpenses,
      sinking_fund_for_window:  sinkingFundForWindow,
      net_available:            netAvailable,
      coverage_ratio:           coverageRatio,
      runway_months:            runwayMonths,
      income_reliability:       incomeReliability,
      auto_publishing_in_window: autoPublishingCount,

      // Per-need breakdown (backward-compat)
      needs,

      // Alerts
      shortfall_warnings: shortfallWarnings,
      alerts,
    });
  } catch (err) {
    console.error('getLifePulse error:', err);
    res.status(500).json({ error: 'Failed to compute Life Pulse.' });
  }
};

// ── helpers ───────────────────────────────────────────────────────────────────
function round2(n) { return Math.round(n * 100) / 100; }
function round1(n) { return Math.round(n * 10)  / 10;  }
