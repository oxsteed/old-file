'use strict';
const db = require('../db');

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

    // ── parallel queries ───────────────────────────────────────────────────
    const [baselineRes, reliabilityRes, oxsteedRes, needsRes] = await Promise.all([

      // 1. 90-day income and expense totals (baseline for daily averages)
      db.query(`
        SELECT
          COALESCE(SUM(amount) FILTER (WHERE type = 'income'),  0) AS income_90d,
          COALESCE(SUM(amount) FILTER (WHERE type = 'expense'), 0) AS expense_90d
        FROM expenses
        WHERE user_id = $1
          AND occurred_at >= CURRENT_DATE - INTERVAL '90 days'
      `, [userId]),

      // 2. Reliability: last 30d vs prior 60d (days 31–90) income
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
    ]);

    const baseline    = baselineRes.rows[0];
    const reliability = reliabilityRes.rows[0];
    const oxsteed     = oxsteedRes.rows[0];
    const rawNeeds    = needsRes.rows;

    // ── 1. Daily averages ───────────────────────────────────────────────────
    const income90d     = parseFloat(baseline.income_90d);
    const expense90d    = parseFloat(baseline.expense_90d);
    const oxsteedIncome = parseFloat(oxsteed.oxsteed_income_90d);

    // Merge OxSteed settled earnings into the income baseline
    const totalIncome90d  = income90d + oxsteedIncome;
    const avgDailyIncome  = totalIncome90d / 90;
    const avgDailyExpense = expense90d / 90;

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

    const sinkingFundForWindow = round2(totalSinkingFund);

    // ── 4. Net, coverage, runway ────────────────────────────────────────────
    const totalObligations = projectedExpenses + sinkingFundForWindow;
    const netAvailable     = round2(projectedIncome - totalObligations);
    const coverageRatio    = totalObligations > 0
      ? round2(projectedIncome / totalObligations)
      : null;

    // Runway: proxy from 90-day cumulative net (estimating built-up buffer).
    // Not a live savings balance, but a strong signal of recent cash trajectory.
    const estimatedBuffer = totalIncome90d - expense90d; // positive = user has been saving
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

    // ── 8. Compute overall pulse score ─────────────────────────────────────
    const cScore = scoreCoverage(coverageRatio);
    const bScore = scoreBuffer(runwayMonths);
    const rScore = scoreReliability(incomeDropPct);
    const oScore = scoreObligations(rawNeeds);

    const pulseScore = Math.max(0, Math.min(100, Math.round(
      cScore * 0.40 +
      bScore * 0.25 +
      rScore * 0.20 +
      oScore * 0.15
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
      oxsteed_income_90d: round2(oxsteedIncome),

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
