/**
 * Service to fetch comprehensive user financial data for AI chatbot context.
 * Aggregates Life Pulse score, expenses, income, planned needs, and goals.
 */

const pool = require('../db');
const logger = require('../utils/logger');

/**
 * Fetch user's complete financial context for AI chatbot.
 * @param {number} userId - User ID
 * @param {string} window - Analysis window: 1w, 2w, 1m, 3m, 6m, 1y, 5y, 10y (default: 1m)
 * @returns {Promise<object>} Aggregated financial data
 */
async function getUserFinancialContext(userId, window = '1m') {
  try {
    // Fetch all data in parallel
    const [
      pulseRes,
      expensesRes,
      incomeRes,
      needsRes,
      goalsRes,
      subscriptionRes,
      helperInfoRes,
    ] = await Promise.allSettled([
      fetchLifePulse(userId, window),
      fetchExpensesSummary(userId),
      fetchIncomeSummary(userId),
      fetchPlannedNeeds(userId),
      fetchGoals(userId),
      fetchSubscription(userId),
      fetchHelperInfo(userId),
    ]);

    return {
      pulse:
        pulseRes.status === 'fulfilled'
          ? pulseRes.value
          : { error: pulseRes.reason?.message },
      expenses:
        expensesRes.status === 'fulfilled'
          ? expensesRes.value
          : { error: expensesRes.reason?.message },
      income:
        incomeRes.status === 'fulfilled'
          ? incomeRes.value
          : { error: incomeRes.reason?.message },
      plannedNeeds:
        needsRes.status === 'fulfilled'
          ? needsRes.value
          : { error: needsRes.reason?.message },
      goals:
        goalsRes.status === 'fulfilled'
          ? goalsRes.value
          : { error: goalsRes.reason?.message },
      subscription:
        subscriptionRes.status === 'fulfilled'
          ? subscriptionRes.value
          : { error: subscriptionRes.reason?.message },
      helper:
        helperInfoRes.status === 'fulfilled'
          ? helperInfoRes.value
          : { error: helperInfoRes.reason?.message },
    };
  } catch (err) {
    logger.error('getUserFinancialContext error', { userId, error: err.message });
    return { error: 'Unable to fetch financial context' };
  }
}

/**
 * Fetch Life Pulse score and breakdown
 */
async function fetchLifePulse(userId, window) {
  const { rows } = await pool.query(
    `SELECT
       pulse_score, score_breakdown, avg_daily_income, avg_daily_expense,
       past_income, predicted_income, present_value_income,
       sources, shortfall_warnings, alerts
     FROM life_pulse_cache
     WHERE user_id = $1 AND window = $2
     LIMIT 1`,
    [userId, window]
  );

  if (!rows.length) {
    return { pulse_score: null, message: 'No pulse data yet. Start logging expenses and income.' };
  }

  const cache = rows[0];
  return {
    pulse_score: cache.pulse_score,
    breakdown: cache.score_breakdown,
    avg_daily_income: cache.avg_daily_income,
    avg_daily_expense: cache.avg_daily_expense,
    projected_income: cache.present_value_income,
    sources: cache.sources,
    warnings: cache.shortfall_warnings,
    alerts: cache.alerts,
    window,
  };
}

/**
 * Fetch this month's expenses summary
 */
async function fetchExpensesSummary(userId) {
  const now = new Date();
  const month = now.getMonth() + 1;
  const year = now.getFullYear();

  const { rows } = await pool.query(
    `SELECT
       type, category, COUNT(*) as count, SUM(amount) as total
     FROM expenses
     WHERE user_id = $1
       AND EXTRACT(MONTH FROM occurred_at) = $2
       AND EXTRACT(YEAR FROM occurred_at) = $3
     GROUP BY type, category
     ORDER BY total DESC`,
    [userId, month, year]
  );

  const byType = {};
  rows.forEach(row => {
    if (!byType[row.type]) byType[row.type] = {};
    byType[row.type][row.category] = {
      total: parseFloat(row.total) || 0,
      count: parseInt(row.count, 10),
    };
  });

  const totalIncome = Object.values(byType.income || {}).reduce(
    (sum, cat) => sum + cat.total,
    0
  );
  const totalExpense = Object.values(byType.expense || {}).reduce(
    (sum, cat) => sum + cat.total,
    0
  );

  return {
    this_month: {
      total_income: parseFloat(totalIncome.toFixed(2)),
      total_expenses: parseFloat(totalExpense.toFixed(2)),
      net: parseFloat((totalIncome - totalExpense).toFixed(2)),
    },
    by_category: byType,
  };
}

/**
 * Fetch income sources (manual, OxSteed, invoices, tool rentals)
 */
async function fetchIncomeSummary(userId) {
  const last90Days = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);

  const [manualRes, oxsteedRes, invoiceRes] = await Promise.all([
    pool.query(
      `SELECT SUM(amount) as total FROM expenses
       WHERE user_id = $1 AND type = 'income' AND occurred_at >= $2`,
      [userId, last90Days]
    ),
    pool.query(
      `SELECT SUM(helper_payout) as total FROM payments
       WHERE payee_id = $1 AND status IN ('captured', 'released') AND created_at >= $2`,
      [userId, last90Days]
    ),
    pool.query(
      `SELECT SUM(amount) as total FROM business_invoices
       WHERE user_id = $1 AND status = 'paid' AND updated_at >= $2`,
      [userId, last90Days]
    ),
  ]);

  return {
    manual_income_90d: parseFloat(manualRes.rows[0]?.total) || 0,
    oxsteed_income_90d: parseFloat(oxsteedRes.rows[0]?.total) || 0,
    business_invoices_90d: parseFloat(invoiceRes.rows[0]?.total) || 0,
  };
}

/**
 * Fetch upcoming planned needs with funding status
 */
async function fetchPlannedNeeds(userId) {
  const { rows } = await pool.query(
    `SELECT id, title, estimated_cost, reserved_amount, due_date, status, category
     FROM planned_needs
     WHERE user_id = $1 AND status NOT IN ('completed', 'cancelled')
     ORDER BY due_date ASC
     LIMIT 10`,
    [userId]
  );

  return {
    total_planned: rows.length,
    total_cost: rows.reduce((sum, n) => sum + (n.estimated_cost || 0), 0),
    needs: rows.map(n => ({
      title: n.title,
      cost: n.estimated_cost,
      due: n.due_date,
      funded: n.reserved_amount,
      funding_pct: n.estimated_cost
        ? Math.round((n.reserved_amount / n.estimated_cost) * 100)
        : 0,
      status: n.status,
    })),
  };
}

/**
 * Fetch active goals and progress
 */
async function fetchGoals(userId) {
  const { rows } = await pool.query(
    `SELECT id, title, target_value, current_value, due_date, is_completed
     FROM goals
     WHERE user_id = $1
     ORDER BY due_date ASC
     LIMIT 10`,
    [userId]
  );

  return {
    total_goals: rows.length,
    completed: rows.filter(g => g.is_completed).length,
    active: rows.filter(g => !g.is_completed).length,
    goals: rows.map(g => ({
      title: g.title,
      progress: g.target_value ? Math.round((g.current_value / g.target_value) * 100) : 0,
      target: g.target_value,
      current: g.current_value,
      due: g.due_date,
      completed: g.is_completed,
    })),
  };
}

/**
 * Fetch current subscription plan
 */
async function fetchSubscription(userId) {
  const { rows } = await pool.query(
    `SELECT
       s.status, s.plan_id, s.current_period_end, s.cancel_at_period_end,
       p.name as plan_name, p.features
     FROM subscriptions s
     LEFT JOIN subscription_plans p ON s.plan_id = p.id
     WHERE s.user_id = $1 AND s.status IN ('active', 'trialing')
     ORDER BY s.created_at DESC
     LIMIT 1`,
    [userId]
  );

  if (!rows.length) {
    return { status: 'free', plan_name: 'Free Plan' };
  }

  const sub = rows[0];
  return {
    status: sub.status,
    plan: sub.plan_name || 'Active',
    period_end: sub.current_period_end,
    cancelling: sub.cancel_at_period_end,
    features: sub.features || [],
  };
}

/**
 * Fetch helper profile info (if user is a helper)
 */
async function fetchHelperInfo(userId) {
  const { rows } = await pool.query(
    `SELECT
       u.role, hp.hourly_rate_min, hp.hourly_rate_max, hp.is_listed,
       hp.avg_rating, hp.jobs_completed, hp.review_count
     FROM users u
     LEFT JOIN helper_profiles hp ON u.id = hp.user_id
     WHERE u.id = $1`,
    [userId]
  );

  if (!rows.length || !rows[0].role.includes('helper')) {
    return null;
  }

  const row = rows[0];
  return {
    is_helper: true,
    hourly_rate_min: row.hourly_rate_min,
    hourly_rate_max: row.hourly_rate_max,
    is_listed: row.is_listed,
    rating: row.avg_rating,
    completed_jobs: row.jobs_completed,
    reviews: row.review_count,
  };
}

/**
 * Format financial context into a concise AI system prompt section.
 */
function formatFinancialContextForAI(context) {
  const lines = ['## User Financial Context'];

  if (context.pulse?.pulse_score != null) {
    lines.push(`**Financial Health Score: ${context.pulse.pulse_score}/100**`);
    if (context.pulse.breakdown) {
      const bd = context.pulse.breakdown;
      lines.push(
        `- Coverage: ${bd.coverage || 0}% | Buffer: ${bd.buffer || 0}% | Reliability: ${bd.reliability || 0}% | Obligations: ${bd.obligations || 0}%`
      );
    }
  }

  if (context.income) {
    lines.push(
      `\n**Income (last 90 days):**\n- Manual: $${context.income.manual_income_90d?.toFixed(2)}\n- OxSteed jobs: $${context.income.oxsteed_income_90d?.toFixed(2)}\n- Invoices: $${context.income.business_invoices_90d?.toFixed(2)}`
    );
  }

  if (context.expenses?.this_month) {
    const exp = context.expenses.this_month;
    lines.push(
      `\n**This Month:**\n- Income: $${exp.total_income?.toFixed(2)}\n- Expenses: $${exp.total_expenses?.toFixed(2)}\n- Net: $${exp.net?.toFixed(2)}`
    );
  }

  if (context.plannedNeeds?.needs?.length) {
    lines.push(
      `\n**Upcoming Planned Needs (${context.plannedNeeds.total_planned}):**`
    );
    context.plannedNeeds.needs.slice(0, 3).forEach(n => {
      lines.push(
        `- ${n.title}: $${n.cost?.toFixed(2)} (${n.funding_pct}% funded, due ${n.due})`
      );
    });
  }

  if (context.goals?.goals?.length) {
    lines.push(`\n**Active Goals (${context.goals.active} active):**`);
    context.goals.goals
      .filter(g => !g.completed)
      .slice(0, 3)
      .forEach(g => {
        lines.push(`- ${g.title}: ${g.progress}% complete (target: $${g.target})`);
      });
  }

  if (context.helper?.is_helper) {
    lines.push(`\n**Helper Profile:**`);
    lines.push(
      `- Rate: $${context.helper.hourly_rate_min}-$${context.helper.hourly_rate_max}/hr`
    );
    lines.push(`- Jobs: ${context.helper.completed_jobs} completed`);
    lines.push(`- Rating: ${context.helper.rating?.toFixed(1) || 'N/A'} (${context.helper.reviews} reviews)`);
  }

  return lines.join('\n');
}

module.exports = {
  getUserFinancialContext,
  formatFinancialContextForAI,
};
