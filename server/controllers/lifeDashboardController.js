const db     = require('../db');
const logger = require('../utils/logger');
const { resolvePublicDisplayName } = require('../utils/publicDisplayName');

// ═══════════════════════════════════════════════════════════════════════════
// EXPENSES
// ═══════════════════════════════════════════════════════════════════════════

exports.getExpenses = async (req, res) => {
  try {
    const userId = req.user.id;
    const { month, year, type, limit = 50, offset = 0 } = req.query;

    const conditions = ['user_id = $1'];
    const params = [userId];

    if (month && year) {
      params.push(parseInt(year), parseInt(month));
      conditions.push(`EXTRACT(YEAR FROM occurred_at) = $${params.length - 1}`);
      conditions.push(`EXTRACT(MONTH FROM occurred_at) = $${params.length}`);
    }
    if (type === 'income' || type === 'expense') {
      params.push(type);
      conditions.push(`type = $${params.length}`);
    }

    const safeLimit  = Math.min(Math.max(parseInt(limit)  || 50, 1), 500);
    const safeOffset = Math.max(parseInt(offset) || 0, 0);
    params.push(safeLimit, safeOffset);
    const { rows } = await db.query(`
      SELECT * FROM expenses
      WHERE ${conditions.join(' AND ')}
      ORDER BY occurred_at DESC, created_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}
    `, params);

    // Monthly summary
    const now = new Date();
    const summaryMonth = month ? parseInt(month) : now.getMonth() + 1;
    const summaryYear = year ? parseInt(year) : now.getFullYear();

    const { rows: summary } = await db.query(`
      SELECT
        COALESCE(SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END), 0) AS total_income,
        COALESCE(SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END), 0) AS total_expenses
      FROM expenses
      WHERE user_id = $1
        AND EXTRACT(YEAR FROM occurred_at) = $2
        AND EXTRACT(MONTH FROM occurred_at) = $3
    `, [userId, summaryYear, summaryMonth]);

    res.json({
      expenses: rows,
      summary: {
        total_income: parseFloat(summary[0].total_income),
        total_expenses: parseFloat(summary[0].total_expenses),
        net: parseFloat(summary[0].total_income) - parseFloat(summary[0].total_expenses),
        month: summaryMonth,
        year: summaryYear,
      },
    });
  } catch (err) {
    logger.error('getExpenses error', { message: err.message });
    res.status(500).json({ error: 'Failed to fetch expenses.' });
  }
};

// Valid frequency values (kept in sync with DB constraint)
const VALID_FREQUENCIES = ['one_time','daily','weekly','bi_weekly','monthly','quarterly','yearly'];

exports.createExpense = async (req, res) => {
  try {
    const userId = req.user.id;
    const {
      type = 'expense', amount, category, description, occurred_at,
      frequency = 'one_time', is_recurring = false,
      recurring_start_date, recurring_end_date,
    } = req.body;

    if (!amount || !category) {
      return res.status(400).json({ error: 'Amount and category are required.' });
    }
    if (!['income', 'expense'].includes(type)) {
      return res.status(400).json({ error: 'Type must be income or expense.' });
    }
    const safeFrequency = VALID_FREQUENCIES.includes(frequency) ? frequency : 'one_time';

    const { rows } = await db.query(`
      INSERT INTO expenses
        (user_id, type, amount, category, description, occurred_at,
         frequency, is_recurring, recurring_start_date, recurring_end_date)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING *
    `, [
      userId, type, amount, category, description || null,
      occurred_at || new Date(),
      safeFrequency, is_recurring || false,
      recurring_start_date || null, recurring_end_date || null,
    ]);

    res.status(201).json(rows[0]);
  } catch (err) {
    logger.error('createExpense error', { message: err.message });
    res.status(500).json({ error: 'Failed to create expense.' });
  }
};

exports.updateExpense = async (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;
    const {
      type, amount, category, description, occurred_at,
      frequency, is_recurring, recurring_start_date, recurring_end_date,
    } = req.body;

    const safeFrequency = frequency && VALID_FREQUENCIES.includes(frequency) ? frequency : undefined;

    const { rows } = await db.query(`
      UPDATE expenses
      SET type = COALESCE($3, type),
          amount = COALESCE($4, amount),
          category = COALESCE($5, category),
          description = COALESCE($6, description),
          occurred_at = COALESCE($7, occurred_at),
          frequency = COALESCE($8, frequency),
          is_recurring = COALESCE($9, is_recurring),
          recurring_start_date = COALESCE($10, recurring_start_date),
          recurring_end_date = COALESCE($11, recurring_end_date),
          updated_at = now()
      WHERE id = $1 AND user_id = $2
      RETURNING *
    `, [id, userId, type, amount, category, description, occurred_at,
        safeFrequency, is_recurring, recurring_start_date, recurring_end_date]);

    if (!rows.length) return res.status(404).json({ error: 'Expense not found.' });
    res.json(rows[0]);
  } catch (err) {
    logger.error('updateExpense error', { message: err.message });
    res.status(500).json({ error: 'Failed to update expense.' });
  }
};

exports.deleteExpense = async (req, res) => {
  try {
    const { id } = req.params;
    const { rowCount } = await db.query(
      'DELETE FROM expenses WHERE id = $1 AND user_id = $2',
      [id, req.user.id]
    );
    if (!rowCount) return res.status(404).json({ error: 'Expense not found.' });
    res.json({ message: 'Expense deleted.' });
  } catch (err) {
    logger.error('deleteExpense error', { message: err.message });
    res.status(500).json({ error: 'Failed to delete expense.' });
  }
};

/**
 * Bulk-upsert iOS Life money entries from the offline queue.
 * Body: { money_entries: [{ client_id, source, amount, type, date }] }
 */
exports.bulkUpsertExpenses = async (req, res) => {
  const userId = req.user.id;
  const items = Array.isArray(req.body?.money_entries) ? req.body.money_entries : [];
  if (items.length === 0) return res.json({ ok: true, upserted: 0 });

  try {
    let count = 0;
    for (const entry of items.slice(0, 500)) {
      const clientId = String(entry.client_id || '').trim();
      const source = String(entry.source || '').trim().substring(0, 255);
      const amount = Number(entry.amount);
      const type = entry.type === 'income' ? 'income' : 'expense';
      if (!clientId || !source || !Number.isFinite(amount) || amount <= 0) continue;

      await db.query(`
        INSERT INTO expenses
          (user_id, client_id, type, amount, category, description, occurred_at)
        VALUES ($1, $2::uuid, $3, $4, $5, $6, NULLIF($7, '')::date)
        ON CONFLICT (user_id, client_id) WHERE client_id IS NOT NULL DO UPDATE
          SET type = EXCLUDED.type,
              amount = EXCLUDED.amount,
              category = EXCLUDED.category,
              description = EXCLUDED.description,
              occurred_at = EXCLUDED.occurred_at,
              updated_at = NOW()
      `, [
        userId,
        clientId,
        type,
        Math.abs(amount),
        type === 'income' ? 'Life Income' : 'Life Expense',
        source,
        entry.date || null,
      ]);
      count++;
    }
    res.json({ ok: true, upserted: count });
  } catch (err) {
    logger.error('bulkUpsertExpenses error', { message: err.message });
    res.status(500).json({ error: 'Bulk upsert failed.' });
  }
};

// Monthly breakdown by category
exports.getExpenseSummary = async (req, res) => {
  try {
    const userId = req.user.id;
    const now = new Date();
    const month = req.query.month || now.getMonth() + 1;
    const year = req.query.year || now.getFullYear();

    const { rows: byCategory } = await db.query(`
      SELECT category, type,
        SUM(amount) AS total,
        COUNT(*) AS count
      FROM expenses
      WHERE user_id = $1
        AND EXTRACT(YEAR FROM occurred_at) = $2
        AND EXTRACT(MONTH FROM occurred_at) = $3
      GROUP BY category, type
      ORDER BY total DESC
    `, [userId, year, month]);

    // Last 6 months trend
    const { rows: trend } = await db.query(`
      SELECT
        EXTRACT(YEAR FROM occurred_at)::int AS year,
        EXTRACT(MONTH FROM occurred_at)::int AS month,
        COALESCE(SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END), 0) AS income,
        COALESCE(SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END), 0) AS expenses
      FROM expenses
      WHERE user_id = $1
        AND occurred_at >= (CURRENT_DATE - INTERVAL '6 months')
      GROUP BY year, month
      ORDER BY year, month
    `, [userId]);

    res.json({ by_category: byCategory, trend });
  } catch (err) {
    logger.error('getExpenseSummary error', { message: err.message });
    res.status(500).json({ error: 'Failed to get summary.' });
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// BUDGET CATEGORIES
// ═══════════════════════════════════════════════════════════════════════════

exports.getBudgets = async (req, res) => {
  try {
    const userId = req.user.id;
    const now = new Date();
    const month = req.query.month || now.getMonth() + 1;
    const year = req.query.year || now.getFullYear();

    const { rows } = await db.query(`
      SELECT
        bc.*,
        COALESCE(spent.total, 0) AS spent
      FROM budget_categories bc
      LEFT JOIN (
        SELECT category, SUM(amount) AS total
        FROM expenses
        WHERE user_id = $1
          AND type = 'expense'
          AND EXTRACT(YEAR FROM occurred_at) = $2
          AND EXTRACT(MONTH FROM occurred_at) = $3
        GROUP BY category
      ) spent ON spent.category = bc.category
      WHERE bc.user_id = $1
      ORDER BY bc.category
    `, [userId, year, month]);

    res.json({ budgets: rows });
  } catch (err) {
    logger.error('getBudgets error', { message: err.message });
    res.status(500).json({ error: 'Failed to fetch budgets.' });
  }
};

// Multiplier to convert a per-period amount into a monthly equivalent
const PERIOD_TO_MONTHLY = {
  daily:     30,
  weekly:    30 / 7,
  bi_weekly: 30 / 14,
  monthly:   1,
  quarterly: 1 / 3,
  yearly:    1 / 12,
};

exports.upsertBudget = async (req, res) => {
  try {
    const userId = req.user.id;
    // Accept either the legacy `monthly_limit` or the new `period_amount` + `period`.
    // If period_amount is provided we normalise to a monthly value and store that.
    const {
      category, color,
      period = 'monthly',
      period_amount,
      monthly_limit,
    } = req.body;

    // Determine the raw amount - prefer period_amount over the legacy field
    const rawAmount = period_amount !== undefined ? parseFloat(period_amount) : parseFloat(monthly_limit);

    if (!category || isNaN(rawAmount) || rawAmount < 0) {
      return res.status(400).json({ error: 'Category and a valid amount are required.' });
    }

    const safePeriod = PERIOD_TO_MONTHLY[period] !== undefined ? period : 'monthly';
    const normalizedMonthly = rawAmount * PERIOD_TO_MONTHLY[safePeriod];

    const { rows } = await db.query(`
      INSERT INTO budget_categories (user_id, category, monthly_limit, color, period)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (user_id, category) DO UPDATE
      SET monthly_limit = $3,
          color = COALESCE($4, budget_categories.color),
          period = $5,
          updated_at = now()
      RETURNING *
    `, [userId, category, normalizedMonthly, color || '#F4A261', safePeriod]);

    res.json(rows[0]);
  } catch (err) {
    logger.error('upsertBudget error', { message: err.message });
    res.status(500).json({ error: 'Failed to save budget.' });
  }
};

exports.deleteBudget = async (req, res) => {
  try {
    const { id } = req.params;
    const { rowCount } = await db.query(
      'DELETE FROM budget_categories WHERE id = $1 AND user_id = $2',
      [id, req.user.id]
    );
    if (!rowCount) return res.status(404).json({ error: 'Budget not found.' });
    res.json({ message: 'Budget deleted.' });
  } catch (err) {
    logger.error('deleteBudget error', { message: err.message });
    res.status(500).json({ error: 'Failed to delete budget.' });
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// GOALS
// ═══════════════════════════════════════════════════════════════════════════

exports.getGoals = async (req, res) => {
  try {
    const userId = req.user.id;
    const { completed } = req.query;

    let condition = 'WHERE user_id = $1';
    if (completed === 'true') condition += ' AND is_completed = true';
    else if (completed === 'false') condition += ' AND is_completed = false';

    const { rows } = await db.query(`
      SELECT * FROM goals
      ${condition}
      ORDER BY is_completed ASC, created_at DESC
    `, [userId]);

    res.json({ goals: rows });
  } catch (err) {
    logger.error('getGoals error', { message: err.message });
    res.status(500).json({ error: 'Failed to fetch goals.' });
  }
};

exports.createGoal = async (req, res) => {
  try {
    const userId = req.user.id;
    const { title, goal_type = 'financial', target_value, current_value = 0, due_date, icon } = req.body;

    if (!title) return res.status(400).json({ error: 'Title is required.' });

    const { rows } = await db.query(`
      INSERT INTO goals (user_id, title, goal_type, target_value, current_value, due_date, icon)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
    `, [userId, title, goal_type, target_value, current_value, due_date || null, icon || '🎯']);

    res.status(201).json(rows[0]);
  } catch (err) {
    logger.error('createGoal error', { message: err.message });
    res.status(500).json({ error: 'Failed to create goal.' });
  }
};

exports.updateGoal = async (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;
    const { title, target_value, current_value, is_completed, due_date, icon } = req.body;

    const { rows } = await db.query(`
      UPDATE goals
      SET title = COALESCE($3, title),
          target_value = COALESCE($4, target_value),
          current_value = COALESCE($5, current_value),
          is_completed = COALESCE($6, is_completed),
          due_date = COALESCE($7, due_date),
          icon = COALESCE($8, icon),
          updated_at = now()
      WHERE id = $1 AND user_id = $2
      RETURNING *
    `, [id, userId, title, target_value, current_value, is_completed, due_date, icon]);

    if (!rows.length) return res.status(404).json({ error: 'Goal not found.' });
    res.json(rows[0]);
  } catch (err) {
    logger.error('updateGoal error', { message: err.message });
    res.status(500).json({ error: 'Failed to update goal.' });
  }
};

exports.deleteGoal = async (req, res) => {
  try {
    const { id } = req.params;
    const { rowCount } = await db.query(
      'DELETE FROM goals WHERE id = $1 AND user_id = $2',
      [id, req.user.id]
    );
    if (!rowCount) return res.status(404).json({ error: 'Goal not found.' });
    res.json({ message: 'Goal deleted.' });
  } catch (err) {
    logger.error('deleteGoal error', { message: err.message });
    res.status(500).json({ error: 'Failed to delete goal.' });
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// SINKING FUNDS
// ═══════════════════════════════════════════════════════════════════════════

exports.getSinkingFunds = async (req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT id, client_id, name, target_amount, saved_amount, target_date,
             paycheck_interval, icon, color, created_at, updated_at
      FROM sinking_funds
      WHERE user_id = $1
      ORDER BY target_date NULLS LAST, created_at DESC
    `, [req.user.id]);
    res.json({ sinking_funds: rows });
  } catch (err) {
    logger.error('getSinkingFunds error', { message: err.message });
    res.status(500).json({ error: 'Failed to fetch sinking funds.' });
  }
};

exports.createSinkingFund = async (req, res) => {
  try {
    const {
      client_id, name, target_amount, saved_amount = 0, target_date,
      paycheck_interval = 'biweekly', icon = 'banknote.fill', color = 'pillarSinking',
    } = req.body;
    const cleanName = String(name || '').trim().substring(0, 200);
    if (!cleanName) return res.status(400).json({ error: 'Name is required.' });

    const targetAmount = Number(target_amount);
    const savedAmount = Number(saved_amount);
    const interval = ['weekly', 'biweekly', 'monthly'].includes(paycheck_interval)
      ? paycheck_interval
      : 'biweekly';

    const { rows } = await db.query(`
      INSERT INTO sinking_funds
        (user_id, client_id, name, target_amount, saved_amount, target_date,
         paycheck_interval, icon, color)
      VALUES ($1, $2::uuid, $3, $4, $5, NULLIF($6, '')::date, $7, $8, $9)
      RETURNING id, client_id, name, target_amount, saved_amount, target_date,
                paycheck_interval, icon, color, created_at, updated_at
    `, [
      req.user.id,
      client_id || null,
      cleanName,
      Number.isFinite(targetAmount) ? Math.max(0, targetAmount) : 0,
      Number.isFinite(savedAmount) ? Math.max(0, savedAmount) : 0,
      target_date || null,
      interval,
      String(icon || 'banknote.fill').substring(0, 80),
      String(color || 'pillarSinking').substring(0, 80),
    ]);

    res.status(201).json(rows[0]);
  } catch (err) {
    logger.error('createSinkingFund error', { message: err.message });
    res.status(500).json({ error: 'Failed to create sinking fund.' });
  }
};

exports.updateSinkingFund = async (req, res) => {
  try {
    const {
      name, target_amount, saved_amount, target_date, paycheck_interval, icon, color,
    } = req.body;
    const interval = paycheck_interval && ['weekly', 'biweekly', 'monthly'].includes(paycheck_interval)
      ? paycheck_interval
      : undefined;

    const { rows } = await db.query(`
      UPDATE sinking_funds
      SET name = COALESCE($3, name),
          target_amount = COALESCE($4, target_amount),
          saved_amount = COALESCE($5, saved_amount),
          target_date = COALESCE(NULLIF($6, '')::date, target_date),
          paycheck_interval = COALESCE($7, paycheck_interval),
          icon = COALESCE($8, icon),
          color = COALESCE($9, color),
          updated_at = NOW()
      WHERE id = $1 AND user_id = $2
      RETURNING id, client_id, name, target_amount, saved_amount, target_date,
                paycheck_interval, icon, color, created_at, updated_at
    `, [
      req.params.id,
      req.user.id,
      name ? String(name).trim().substring(0, 200) : undefined,
      target_amount === undefined ? undefined : Math.max(0, Number(target_amount) || 0),
      saved_amount === undefined ? undefined : Math.max(0, Number(saved_amount) || 0),
      target_date,
      interval,
      icon ? String(icon).substring(0, 80) : undefined,
      color ? String(color).substring(0, 80) : undefined,
    ]);

    if (!rows.length) return res.status(404).json({ error: 'Sinking fund not found.' });
    res.json(rows[0]);
  } catch (err) {
    logger.error('updateSinkingFund error', { message: err.message });
    res.status(500).json({ error: 'Failed to update sinking fund.' });
  }
};

exports.deleteSinkingFund = async (req, res) => {
  try {
    const { rowCount } = await db.query(
      'DELETE FROM sinking_funds WHERE id = $1 AND user_id = $2',
      [req.params.id, req.user.id]
    );
    if (!rowCount) return res.status(404).json({ error: 'Sinking fund not found.' });
    res.json({ message: 'Sinking fund deleted.' });
  } catch (err) {
    logger.error('deleteSinkingFund error', { message: err.message });
    res.status(500).json({ error: 'Failed to delete sinking fund.' });
  }
};

/**
 * Bulk-upsert iOS Life sinking funds from the offline queue.
 * Body: { sinking_funds: [{ client_id, name, target_amount, saved_amount,
 *                          target_date, paycheck_interval, icon, color }] }
 */
exports.bulkUpsertSinkingFunds = async (req, res) => {
  const userId = req.user.id;
  const items = Array.isArray(req.body?.sinking_funds) ? req.body.sinking_funds : [];
  if (items.length === 0) return res.json({ ok: true, upserted: 0 });

  try {
    let count = 0;
    for (const fund of items.slice(0, 100)) {
      const clientId = String(fund.client_id || '').trim();
      const name = String(fund.name || '').trim().substring(0, 200);
      const targetAmount = Number(fund.target_amount);
      const savedAmount = Number(fund.saved_amount);
      const interval = ['weekly', 'biweekly', 'monthly'].includes(fund.paycheck_interval)
        ? fund.paycheck_interval
        : 'biweekly';
      if (!clientId || !name) continue;

      await db.query(`
        INSERT INTO sinking_funds
          (user_id, client_id, name, target_amount, saved_amount, target_date,
           paycheck_interval, icon, color)
        VALUES ($1, $2::uuid, $3, $4, $5, NULLIF($6, '')::date, $7, $8, $9)
        ON CONFLICT (user_id, client_id) DO UPDATE
          SET name = EXCLUDED.name,
              target_amount = EXCLUDED.target_amount,
              saved_amount = EXCLUDED.saved_amount,
              target_date = EXCLUDED.target_date,
              paycheck_interval = EXCLUDED.paycheck_interval,
              icon = EXCLUDED.icon,
              color = EXCLUDED.color,
              updated_at = NOW()
      `, [
        userId,
        clientId,
        name,
        Number.isFinite(targetAmount) ? Math.max(0, targetAmount) : 0,
        Number.isFinite(savedAmount) ? Math.max(0, savedAmount) : 0,
        fund.target_date || null,
        interval,
        String(fund.icon || 'banknote.fill').substring(0, 80),
        String(fund.color || 'pillarSinking').substring(0, 80),
      ]);
      count++;
    }
    res.json({ ok: true, upserted: count });
  } catch (err) {
    logger.error('bulkUpsertSinkingFunds error', { message: err.message });
    res.status(500).json({ error: 'Bulk upsert failed.' });
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// SAVED HELPERS
// ═══════════════════════════════════════════════════════════════════════════

exports.getSavedHelpers = async (req, res) => {
  try {
    const userId = req.user.id;

    const { rows } = await db.query(`
      SELECT
        sh.id, sh.helper_id, sh.note, sh.created_at,
        u.first_name, u.last_name, u.display_name_preference,
        pb.business_name AS primary_business_name,
        hp.avg_rating, hp.completed_jobs_count AS completed_jobs,
        hp.bio_short
      FROM saved_helpers sh
      JOIN users u ON u.id = sh.helper_id
      LEFT JOIN helper_profiles hp ON hp.user_id = sh.helper_id
      LEFT JOIN businesses pb ON pb.user_id = u.id AND pb.is_primary = TRUE AND pb.is_active = TRUE
      WHERE sh.user_id = $1
      ORDER BY sh.created_at DESC
    `, [userId]);

    res.json({
      saved_helpers: rows.map((row) => {
        const displayName = resolvePublicDisplayName(row);
        return {
          ...row,
          display_name: displayName,
          first_name: displayName,
          last_name: null,
          display_name_preference: undefined,
          primary_business_name: undefined,
        };
      }),
    });
  } catch (err) {
    logger.error('getSavedHelpers error', { message: err.message });
    res.status(500).json({ error: 'Failed to fetch saved helpers.' });
  }
};

exports.saveHelper = async (req, res) => {
  try {
    const userId = req.user.id;
    const { helper_id, note } = req.body;

    if (!helper_id) return res.status(400).json({ error: 'helper_id is required.' });
    if (helper_id === userId) return res.status(400).json({ error: 'Cannot save yourself.' });

    const { rows } = await db.query(`
      INSERT INTO saved_helpers (user_id, helper_id, note)
      VALUES ($1, $2, $3)
      ON CONFLICT (user_id, helper_id) DO UPDATE
      SET note = COALESCE($3, saved_helpers.note)
      RETURNING *
    `, [userId, helper_id, note || null]);

    res.status(201).json(rows[0]);
  } catch (err) {
    logger.error('saveHelper error', { message: err.message });
    res.status(500).json({ error: 'Failed to save helper.' });
  }
};

exports.removeSavedHelper = async (req, res) => {
  try {
    const { id } = req.params;
    const { rowCount } = await db.query(
      'DELETE FROM saved_helpers WHERE id = $1 AND user_id = $2',
      [id, req.user.id]
    );
    if (!rowCount) return res.status(404).json({ error: 'Saved helper not found.' });
    res.json({ message: 'Helper removed from saved list.' });
  } catch (err) {
    logger.error('removeSavedHelper error', { message: err.message });
    res.status(500).json({ error: 'Failed to remove saved helper.' });
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// HOME TASKS
// ═══════════════════════════════════════════════════════════════════════════

exports.getHomeTasks = async (req, res) => {
  try {
    const userId = req.user.id;
    const { completed, section } = req.query;

    const conditions = ['ht.user_id = $1'];
    const params = [userId];

    if (completed === 'true') conditions.push('is_completed = true');
    else if (completed === 'false') conditions.push('is_completed = false');

    if (section) {
      params.push(section);
      conditions.push(`section = $${params.length}`);
    } else {
      conditions.push(`section = 'home'`);
    }

    const { rows } = await db.query(`
      SELECT
        ht.*,
        COALESCE(uv.nickname, uv.make_name || ' ' || uv.model_name) AS vehicle_name,
        COALESCE(uh.nickname, uh.address) AS home_name
      FROM home_tasks ht
      LEFT JOIN user_vehicles uv ON uv.id = ht.vehicle_id
      LEFT JOIN user_homes uh ON uh.id = ht.home_id
      WHERE ${conditions.join(' AND ')}
      ORDER BY
        ht.is_completed ASC,
        CASE ht.urgency WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END,
        ht.due_date ASC NULLS LAST,
        ht.created_at DESC
    `, params);

    res.json({ home_tasks: rows });
  } catch (err) {
    logger.error('getHomeTasks error', { message: err.message });
    res.status(500).json({ error: 'Failed to fetch home tasks.' });
  }
};

// Map named frequency to recurrence_days for backward compat with any cron/scheduler reading that column
const FREQUENCY_DAYS = {
  daily: 1, weekly: 7, bi_weekly: 14, monthly: 30,
  quarterly: 91, yearly: 365, one_time: null,
};

exports.createHomeTask = async (req, res) => {
  try {
    const userId = req.user.id;
    const {
      title, description, due_date, recurrence_days, urgency = 'low', section = 'home',
      frequency, is_recurring = false, estimated_cost,
      recurring_start_date, recurring_end_date,
      vehicle_id, home_id,
    } = req.body;

    if (!title) return res.status(400).json({ error: 'Title is required.' });
    const allowedSections = ['home', 'personal_care', 'car_care'];
    const safeSection = allowedSections.includes(section) ? section : 'home';

    const safeFrequency = frequency && VALID_FREQUENCIES.includes(frequency) ? frequency : null;
    // Derive recurrence_days from frequency if frequency provided, otherwise use explicit value
    const effectiveRecurrenceDays = safeFrequency
      ? FREQUENCY_DAYS[safeFrequency]
      : (recurrence_days || null);

    const { rows } = await db.query(`
      INSERT INTO home_tasks
        (user_id, title, description, due_date, recurrence_days, urgency, section,
         frequency, is_recurring, estimated_cost, recurring_start_date, recurring_end_date,
         vehicle_id, home_id)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      RETURNING *
    `, [
      userId, title, description || null, due_date || null,
      effectiveRecurrenceDays, urgency, safeSection,
      safeFrequency, is_recurring || false,
      estimated_cost ? parseFloat(estimated_cost) : null,
      recurring_start_date || null, recurring_end_date || null,
      vehicle_id ? parseInt(vehicle_id) : null,
      home_id    ? parseInt(home_id)    : null,
    ]);

    res.status(201).json(rows[0]);
  } catch (err) {
    logger.error('createHomeTask error', { message: err.message });
    res.status(500).json({ error: 'Failed to create home task.' });
  }
};

exports.updateHomeTask = async (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;
    const {
      title, description, due_date, recurrence_days, urgency, is_completed,
      frequency, is_recurring, estimated_cost, recurring_start_date, recurring_end_date,
      vehicle_id, home_id,
    } = req.body;

    const safeFrequency = frequency && VALID_FREQUENCIES.includes(frequency) ? frequency : undefined;
    const effectiveRecurrenceDays = safeFrequency
      ? FREQUENCY_DAYS[safeFrequency]
      : recurrence_days;

    const { rows } = await db.query(`
      UPDATE home_tasks
      SET title = COALESCE($3, title),
          description = COALESCE($4, description),
          due_date = COALESCE($5, due_date),
          recurrence_days = COALESCE($6, recurrence_days),
          urgency = COALESCE($7, urgency),
          is_completed = COALESCE($8, is_completed),
          completed_at = CASE WHEN $8 = true THEN now() WHEN $8 = false THEN NULL ELSE completed_at END,
          frequency = COALESCE($9, frequency),
          is_recurring = COALESCE($10, is_recurring),
          estimated_cost = COALESCE($11, estimated_cost),
          recurring_start_date = COALESCE($12, recurring_start_date),
          recurring_end_date = COALESCE($13, recurring_end_date),
          vehicle_id = COALESCE($14, vehicle_id),
          home_id    = COALESCE($15, home_id),
          updated_at = now()
      WHERE id = $1 AND user_id = $2
      RETURNING *
    `, [id, userId, title, description, due_date, effectiveRecurrenceDays, urgency, is_completed,
        safeFrequency, is_recurring, estimated_cost ? parseFloat(estimated_cost) : undefined,
        recurring_start_date, recurring_end_date,
        vehicle_id ? parseInt(vehicle_id) : undefined,
        home_id    ? parseInt(home_id)    : undefined]);

    if (!rows.length) return res.status(404).json({ error: 'Home task not found.' });
    res.json(rows[0]);
  } catch (err) {
    logger.error('updateHomeTask error', { message: err.message });
    res.status(500).json({ error: 'Failed to update home task.' });
  }
};

exports.deleteHomeTask = async (req, res) => {
  try {
    const { id } = req.params;
    const { rowCount } = await db.query(
      'DELETE FROM home_tasks WHERE id = $1 AND user_id = $2',
      [id, req.user.id]
    );
    if (!rowCount) return res.status(404).json({ error: 'Home task not found.' });
    res.json({ message: 'Home task deleted.' });
  } catch (err) {
    logger.error('deleteHomeTask error', { message: err.message });
    res.status(500).json({ error: 'Failed to delete home task.' });
  }
};

/**
 * Bulk-upsert home tasks from iOS offline queue.
 * Matches on (user_id, title, section) — inserts if missing, updates is_completed if found.
 * POST /api/life/home-tasks/bulk-upsert
 * Body: { home_tasks: [{ title, section, is_completed, is_recurring, due_date }] }
 */
exports.bulkUpsertHomeTasks = async (req, res) => {
  const userId = req.user.id;
  const items  = Array.isArray(req.body?.home_tasks) ? req.body.home_tasks : [];
  if (items.length === 0) return res.json({ ok: true, upserted: 0 });

  try {
    let count = 0;
    const allowedSections = ['home', 'personal_care', 'car_care'];
    for (const t of items.slice(0, 200)) {
      const title   = String(t.title || '').trim().substring(0, 200);
      const rawSection = String(t.section || 'home').substring(0, 50);
      const section = allowedSections.includes(rawSection) ? rawSection : 'home';
      if (!title) continue;

      await db.query(`
        INSERT INTO home_tasks (user_id, title, section, is_completed, is_recurring, due_date)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (user_id, title, section) DO UPDATE
          SET is_completed = EXCLUDED.is_completed,
              is_recurring = EXCLUDED.is_recurring,
              due_date     = EXCLUDED.due_date,
              updated_at   = NOW()
      `, [
        userId, title, section,
        t.is_completed ?? false,
        t.is_recurring ?? false,
        t.due_date || null,
      ]);
      count++;
    }
    res.json({ ok: true, upserted: count });
  } catch (err) {
    logger.error('bulkUpsertHomeTasks error', { message: err.message });
    res.status(500).json({ error: 'Bulk upsert failed.' });
  }
};

/**
 * Bulk-upsert Life goals from iOS offline queue.
 * Matches on (user_id, title) — inserts if missing, updates is_completed if found.
 * POST /api/life/goals/bulk-upsert
 * Body: { goals: [{ title, tier, is_completed }] }
 */
exports.bulkUpsertGoals = async (req, res) => {
  const userId = req.user.id;
  const items  = Array.isArray(req.body?.goals) ? req.body.goals : [];
  if (items.length === 0) return res.json({ ok: true, upserted: 0 });

  try {
    let count = 0;
    for (const g of items.slice(0, 100)) {
      const title = String(g.title || '').trim().substring(0, 300);
      const tier  = ['short', 'mid', 'long'].includes(g.tier) ? g.tier : 'short';
      if (!title) continue;

      await db.query(`
        INSERT INTO goals (user_id, title, tier, is_completed)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (user_id, title) DO UPDATE
          SET tier         = EXCLUDED.tier,
              is_completed = EXCLUDED.is_completed,
              updated_at   = NOW()
      `, [userId, title, tier, g.is_completed ?? false]);
      count++;
    }
    res.json({ ok: true, upserted: count });
  } catch (err) {
    logger.error('bulkUpsertGoals error', { message: err.message });
    res.status(500).json({ error: 'Bulk upsert failed.' });
  }
};

function stablePositiveInt(input) {
  let hash = 0;
  const value = String(input || '').toLowerCase();
  for (let i = 0; i < value.length; i++) {
    hash = ((hash << 5) - hash) + value.charCodeAt(i);
    hash |= 0;
  }
  return Math.max(1, Math.abs(hash));
}

function lifeVehicleColumns() {
  return `
    id, client_id, vin, year, make_name AS make, model_name AS model,
    mileage, last_oil_change_mile, last_service_date, notes,
    created_at, updated_at
  `;
}

// ═══════════════════════════════════════════════════════════════════════════
// LIFE GARAGE
// ═══════════════════════════════════════════════════════════════════════════

exports.getLifeVehicles = async (req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT ${lifeVehicleColumns()}
      FROM user_vehicles
      WHERE user_id = $1
      ORDER BY updated_at DESC, created_at DESC
    `, [req.user.id]);
    res.json({ vehicles: rows });
  } catch (err) {
    logger.error('getLifeVehicles error', { message: err.message });
    res.status(500).json({ error: 'Failed to fetch vehicles.' });
  }
};

exports.createLifeVehicle = async (req, res) => {
  try {
    const {
      client_id, vin, year, make, model, make_name, model_name,
      mileage, last_oil_change_mile, last_service_date, notes,
    } = req.body;
    const cleanMake = String(make || make_name || '').trim().substring(0, 80);
    const cleanModel = String(model || model_name || '').trim().substring(0, 120);
    if (!cleanMake || !cleanModel) return res.status(400).json({ error: 'Make and model are required.' });

    const makeId = stablePositiveInt(cleanMake);
    const modelId = stablePositiveInt(`${cleanMake}:${cleanModel}`);
    const parsedYear = parseInt(year, 10);

    const { rows } = await db.query(`
      INSERT INTO user_vehicles
        (user_id, client_id, make_id, make_name, model_id, model_name, year,
         nickname, notes, vin, mileage, last_oil_change_mile, last_service_date)
      VALUES ($1, $2::uuid, $3, $4, $5, $6, $7, NULL, $8, NULLIF($9, ''),
              $10, $11, NULLIF($12, '')::date)
      ON CONFLICT (user_id, client_id) WHERE client_id IS NOT NULL DO UPDATE
        SET make_id = EXCLUDED.make_id,
            make_name = EXCLUDED.make_name,
            model_id = EXCLUDED.model_id,
            model_name = EXCLUDED.model_name,
            year = EXCLUDED.year,
            notes = EXCLUDED.notes,
            vin = EXCLUDED.vin,
            mileage = EXCLUDED.mileage,
            last_oil_change_mile = EXCLUDED.last_oil_change_mile,
            last_service_date = EXCLUDED.last_service_date,
            updated_at = NOW()
      RETURNING ${lifeVehicleColumns()}
    `, [
      req.user.id,
      client_id || null,
      makeId,
      cleanMake,
      modelId,
      cleanModel,
      Number.isFinite(parsedYear) ? parsedYear : null,
      notes ? String(notes).trim().substring(0, 500) : null,
      vin ? String(vin).trim().substring(0, 17).toUpperCase() : '',
      Math.max(0, parseInt(mileage, 10) || 0),
      Math.max(0, parseInt(last_oil_change_mile, 10) || 0),
      last_service_date || null,
    ]);

    res.status(201).json(rows[0]);
  } catch (err) {
    logger.error('createLifeVehicle error', { message: err.message });
    res.status(500).json({ error: 'Failed to create vehicle.' });
  }
};

exports.updateLifeVehicle = async (req, res) => {
  try {
    const {
      vin, year, make, model, mileage, last_oil_change_mile, last_service_date, notes,
    } = req.body;
    const cleanMake = make === undefined ? undefined : String(make || '').trim().substring(0, 80);
    const cleanModel = model === undefined ? undefined : String(model || '').trim().substring(0, 120);
    const parsedYear = year === undefined ? undefined : parseInt(year, 10);

    const { rows } = await db.query(`
      UPDATE user_vehicles
      SET make_id = COALESCE($3, make_id),
          make_name = COALESCE($4, make_name),
          model_id = COALESCE($5, model_id),
          model_name = COALESCE($6, model_name),
          year = COALESCE($7, year),
          vin = COALESCE($8, vin),
          mileage = COALESCE($9, mileage),
          last_oil_change_mile = COALESCE($10, last_oil_change_mile),
          last_service_date = COALESCE(NULLIF($11, '')::date, last_service_date),
          notes = COALESCE($12, notes),
          updated_at = NOW()
      WHERE id = $1 AND user_id = $2
      RETURNING ${lifeVehicleColumns()}
    `, [
      req.params.id,
      req.user.id,
      cleanMake ? stablePositiveInt(cleanMake) : undefined,
      cleanMake || undefined,
      cleanModel ? stablePositiveInt(`${cleanMake || ''}:${cleanModel}`) : undefined,
      cleanModel || undefined,
      Number.isFinite(parsedYear) ? parsedYear : undefined,
      vin === undefined ? undefined : String(vin || '').trim().substring(0, 17).toUpperCase(),
      mileage === undefined ? undefined : Math.max(0, parseInt(mileage, 10) || 0),
      last_oil_change_mile === undefined ? undefined : Math.max(0, parseInt(last_oil_change_mile, 10) || 0),
      last_service_date,
      notes === undefined ? undefined : String(notes || '').trim().substring(0, 500),
    ]);

    if (!rows.length) return res.status(404).json({ error: 'Vehicle not found.' });
    res.json(rows[0]);
  } catch (err) {
    logger.error('updateLifeVehicle error', { message: err.message });
    res.status(500).json({ error: 'Failed to update vehicle.' });
  }
};

exports.deleteLifeVehicle = async (req, res) => {
  try {
    const { rowCount } = await db.query(
      'DELETE FROM user_vehicles WHERE id = $1 AND user_id = $2',
      [req.params.id, req.user.id]
    );
    if (!rowCount) return res.status(404).json({ error: 'Vehicle not found.' });
    res.json({ message: 'Vehicle deleted.' });
  } catch (err) {
    logger.error('deleteLifeVehicle error', { message: err.message });
    res.status(500).json({ error: 'Failed to delete vehicle.' });
  }
};

/**
 * Bulk-upsert iOS Life garage vehicles from the offline queue.
 * Body: { vehicles: [{ client_id, vin, year, make, model, mileage,
 *                      last_oil_change_mile, last_service_date, notes }] }
 */
exports.bulkUpsertVehicles = async (req, res) => {
  const userId = req.user.id;
  const items = Array.isArray(req.body?.vehicles) ? req.body.vehicles : [];
  if (items.length === 0) return res.json({ ok: true, upserted: 0 });

  try {
    let count = 0;
    for (const vehicle of items.slice(0, 100)) {
      const clientId = String(vehicle.client_id || '').trim();
      const make = String(vehicle.make || vehicle.make_name || '').trim().substring(0, 80);
      const model = String(vehicle.model || vehicle.model_name || '').trim().substring(0, 120);
      const year = parseInt(vehicle.year, 10);
      if (!clientId || !make || !model) continue;

      const makeId = parseInt(vehicle.make_id, 10) || stablePositiveInt(make);
      const modelId = parseInt(vehicle.model_id, 10) || stablePositiveInt(`${make}:${model}`);
      const mileage = Math.max(0, parseInt(vehicle.mileage, 10) || 0);
      const lastOil = Math.max(0, parseInt(vehicle.last_oil_change_mile, 10) || 0);

      await db.query(`
        INSERT INTO user_vehicles
          (user_id, client_id, make_id, make_name, model_id, model_name, year,
           nickname, notes, vin, mileage, last_oil_change_mile, last_service_date)
        VALUES ($1, $2::uuid, $3, $4, $5, $6, $7, $8, $9, NULLIF($10, ''), $11, $12, NULLIF($13, '')::date)
        ON CONFLICT (user_id, client_id) WHERE client_id IS NOT NULL DO UPDATE
          SET make_id = EXCLUDED.make_id,
              make_name = EXCLUDED.make_name,
              model_id = EXCLUDED.model_id,
              model_name = EXCLUDED.model_name,
              year = EXCLUDED.year,
              nickname = EXCLUDED.nickname,
              notes = EXCLUDED.notes,
              vin = EXCLUDED.vin,
              mileage = EXCLUDED.mileage,
              last_oil_change_mile = EXCLUDED.last_oil_change_mile,
              last_service_date = EXCLUDED.last_service_date,
              updated_at = NOW()
      `, [
        userId,
        clientId,
        makeId,
        make,
        modelId,
        model,
        Number.isFinite(year) ? year : null,
        vehicle.nickname ? String(vehicle.nickname).trim().substring(0, 80) : null,
        vehicle.notes ? String(vehicle.notes).trim().substring(0, 500) : null,
        vehicle.vin ? String(vehicle.vin).trim().substring(0, 17).toUpperCase() : '',
        mileage,
        lastOil,
        vehicle.last_service_date || null,
      ]);
      count++;
    }
    res.json({ ok: true, upserted: count });
  } catch (err) {
    logger.error('bulkUpsertVehicles error', { message: err.message });
    res.status(500).json({ error: 'Bulk upsert failed.' });
  }
};

function lifeHabitColumns() {
  return `
    id, client_id, name, icon, streak, completed_today,
    target_days_per_week, created_at, updated_at
  `;
}

// ═══════════════════════════════════════════════════════════════════════════
// LIFE HABITS
// ═══════════════════════════════════════════════════════════════════════════

exports.getLifeHabits = async (req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT ${lifeHabitColumns()}
      FROM life_habits
      WHERE user_id = $1
      ORDER BY completed_today ASC, updated_at DESC, created_at DESC
    `, [req.user.id]);
    res.json({ habits: rows });
  } catch (err) {
    logger.error('getLifeHabits error', { message: err.message });
    res.status(500).json({ error: 'Failed to fetch habits.' });
  }
};

exports.createLifeHabit = async (req, res) => {
  try {
    const { client_id, name, icon = 'circle.fill', streak = 0, completed_today = false, target_days_per_week = 1 } = req.body;
    const cleanName = String(name || '').trim().substring(0, 120);
    if (!cleanName) return res.status(400).json({ error: 'Name is required.' });
    if (!client_id) return res.status(400).json({ error: 'Client id is required.' });
    const target = Math.min(7, Math.max(1, parseInt(target_days_per_week, 10) || 1));

    const { rows } = await db.query(`
      INSERT INTO life_habits
        (user_id, client_id, name, icon, streak, completed_today, target_days_per_week)
      VALUES ($1, $2::uuid, $3, $4, $5, $6, $7)
      ON CONFLICT (user_id, client_id) DO UPDATE
        SET name = EXCLUDED.name,
            icon = EXCLUDED.icon,
            streak = EXCLUDED.streak,
            completed_today = EXCLUDED.completed_today,
            target_days_per_week = EXCLUDED.target_days_per_week,
            updated_at = NOW()
      RETURNING ${lifeHabitColumns()}
    `, [
      req.user.id,
      client_id || null,
      cleanName,
      String(icon || 'circle.fill').substring(0, 80),
      Math.max(0, parseInt(streak, 10) || 0),
      completed_today === true,
      target,
    ]);

    res.status(201).json(rows[0]);
  } catch (err) {
    logger.error('createLifeHabit error', { message: err.message });
    res.status(500).json({ error: 'Failed to create habit.' });
  }
};

exports.updateLifeHabit = async (req, res) => {
  try {
    const { name, icon, streak, completed_today, target_days_per_week } = req.body;
    const target = target_days_per_week === undefined
      ? undefined
      : Math.min(7, Math.max(1, parseInt(target_days_per_week, 10) || 1));

    const { rows } = await db.query(`
      UPDATE life_habits
      SET name = COALESCE($3, name),
          icon = COALESCE($4, icon),
          streak = COALESCE($5, streak),
          completed_today = COALESCE($6, completed_today),
          target_days_per_week = COALESCE($7, target_days_per_week),
          updated_at = NOW()
      WHERE id = $1 AND user_id = $2
      RETURNING ${lifeHabitColumns()}
    `, [
      req.params.id,
      req.user.id,
      name === undefined ? undefined : String(name || '').trim().substring(0, 120),
      icon === undefined ? undefined : String(icon || 'circle.fill').substring(0, 80),
      streak === undefined ? undefined : Math.max(0, parseInt(streak, 10) || 0),
      completed_today,
      target,
    ]);

    if (!rows.length) return res.status(404).json({ error: 'Habit not found.' });
    res.json(rows[0]);
  } catch (err) {
    logger.error('updateLifeHabit error', { message: err.message });
    res.status(500).json({ error: 'Failed to update habit.' });
  }
};

exports.deleteLifeHabit = async (req, res) => {
  try {
    const { rowCount } = await db.query(
      'DELETE FROM life_habits WHERE id = $1 AND user_id = $2',
      [req.params.id, req.user.id]
    );
    if (!rowCount) return res.status(404).json({ error: 'Habit not found.' });
    res.json({ message: 'Habit deleted.' });
  } catch (err) {
    logger.error('deleteLifeHabit error', { message: err.message });
    res.status(500).json({ error: 'Failed to delete habit.' });
  }
};

/**
 * Bulk-upsert iOS Life habits from the offline queue.
 * Body: { habits: [{ client_id, name, icon, streak, completed_today, target_days_per_week }] }
 */
exports.bulkUpsertHabits = async (req, res) => {
  const userId = req.user.id;
  const items = Array.isArray(req.body?.habits) ? req.body.habits : [];
  if (items.length === 0) return res.json({ ok: true, upserted: 0 });

  try {
    let count = 0;
    for (const habit of items.slice(0, 100)) {
      const clientId = String(habit.client_id || '').trim();
      const name = String(habit.name || '').trim().substring(0, 120);
      if (!clientId || !name) continue;

      const target = Math.min(7, Math.max(1, parseInt(habit.target_days_per_week, 10) || 1));
      const streak = Math.max(0, parseInt(habit.streak, 10) || 0);

      await db.query(`
        INSERT INTO life_habits
          (user_id, client_id, name, icon, streak, completed_today, target_days_per_week)
        VALUES ($1, $2::uuid, $3, $4, $5, $6, $7)
        ON CONFLICT (user_id, client_id) DO UPDATE
          SET name = EXCLUDED.name,
              icon = EXCLUDED.icon,
              streak = EXCLUDED.streak,
              completed_today = EXCLUDED.completed_today,
              target_days_per_week = EXCLUDED.target_days_per_week,
              updated_at = NOW()
      `, [
        userId,
        clientId,
        name,
        String(habit.icon || 'circle.fill').substring(0, 80),
        streak,
        habit.completed_today === true,
        target,
      ]);
      count++;
    }
    res.json({ ok: true, upserted: count });
  } catch (err) {
    logger.error('bulkUpsertHabits error', { message: err.message });
    res.status(500).json({ error: 'Bulk upsert failed.' });
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// CHECKLIST ITEMS
// ═══════════════════════════════════════════════════════════════════════════

exports.getChecklist = async (req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT * FROM checklist_items
      WHERE user_id = $1
      ORDER BY is_completed ASC, due_date ASC NULLS LAST, created_at DESC
    `, [req.user.id]);

    res.json({ items: rows });
  } catch (err) {
    logger.error('getChecklist error', { message: err.message });
    res.status(500).json({ error: 'Failed to fetch checklist.' });
  }
};

exports.createChecklistItem = async (req, res) => {
  try {
    const { title, due_date } = req.body;
    if (!title) return res.status(400).json({ error: 'Title is required.' });

    const { rows } = await db.query(`
      INSERT INTO checklist_items (user_id, title, due_date)
      VALUES ($1, $2, $3)
      RETURNING *
    `, [req.user.id, title, due_date || null]);

    res.status(201).json(rows[0]);
  } catch (err) {
    logger.error('createChecklistItem error', { message: err.message });
    res.status(500).json({ error: 'Failed to create checklist item.' });
  }
};

exports.updateChecklistItem = async (req, res) => {
  try {
    const { id } = req.params;
    const { title, due_date, is_completed } = req.body;

    const { rows } = await db.query(`
      UPDATE checklist_items
      SET title = COALESCE($3, title),
          due_date = COALESCE($4, due_date),
          is_completed = COALESCE($5, is_completed),
          completed_at = CASE WHEN $5 = true THEN now() WHEN $5 = false THEN NULL ELSE completed_at END
      WHERE id = $1 AND user_id = $2
      RETURNING *
    `, [id, req.user.id, title, due_date, is_completed]);

    if (!rows.length) return res.status(404).json({ error: 'Item not found.' });
    res.json(rows[0]);
  } catch (err) {
    logger.error('updateChecklistItem error', { message: err.message });
    res.status(500).json({ error: 'Failed to update checklist item.' });
  }
};

exports.deleteChecklistItem = async (req, res) => {
  try {
    const { id } = req.params;
    const { rowCount } = await db.query(
      'DELETE FROM checklist_items WHERE id = $1 AND user_id = $2',
      [id, req.user.id]
    );
    if (!rowCount) return res.status(404).json({ error: 'Item not found.' });
    res.json({ message: 'Item deleted.' });
  } catch (err) {
    logger.error('deleteChecklistItem error', { message: err.message });
    res.status(500).json({ error: 'Failed to delete checklist item.' });
  }
};

function currency(value) {
  const amount = Number(value) || 0;
  return `$${Math.round(amount).toLocaleString('en-US')}`;
}

function addSuggestion(suggestions, text) {
  if (suggestions.length < 3 && text && !suggestions.includes(text)) {
    suggestions.push(text);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// PULSE INSIGHT
// ═══════════════════════════════════════════════════════════════════════════

exports.getPulseInsight = async (req, res) => {
  try {
    const userId = req.user.id;
    const now = new Date();
    const month = now.getMonth() + 1;
    const year = now.getFullYear();

    const [
      expenseRes,
      goalsRes,
      homeRes,
      sinkingRes,
      habitsRes,
      vehiclesRes,
    ] = await Promise.all([
      db.query(`
        SELECT
          COALESCE(SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END), 0) AS total_income,
          COALESCE(SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END), 0) AS total_expenses
        FROM expenses
        WHERE user_id = $1
          AND EXTRACT(YEAR FROM occurred_at) = $2
          AND EXTRACT(MONTH FROM occurred_at) = $3
      `, [userId, year, month]),
      db.query(`
        SELECT
          COUNT(*) FILTER (WHERE NOT is_completed) AS active_goals,
          COUNT(*) FILTER (WHERE is_completed) AS completed_goals,
          ROUND(AVG(
            CASE WHEN target_value > 0 AND NOT is_completed
            THEN LEAST(current_value / target_value * 100, 100)
            ELSE NULL END
          ), 0) AS avg_progress
        FROM goals
        WHERE user_id = $1
      `, [userId]),
      db.query(`
        SELECT
          COUNT(*) FILTER (WHERE NOT is_completed AND due_date < CURRENT_DATE) AS overdue,
          COUNT(*) FILTER (WHERE NOT is_completed AND due_date >= CURRENT_DATE AND due_date <= CURRENT_DATE + INTERVAL '7 days') AS due_this_week,
          COUNT(*) FILTER (WHERE NOT is_completed) AS total_pending
        FROM home_tasks
        WHERE user_id = $1
      `, [userId]),
      db.query(`
        SELECT
          COUNT(*) AS total_funds,
          COALESCE(SUM(saved_amount), 0) AS saved_amount,
          COALESCE(SUM(target_amount), 0) AS target_amount
        FROM sinking_funds
        WHERE user_id = $1
      `, [userId]),
      db.query(`
        SELECT
          COUNT(*) AS total_habits,
          COUNT(*) FILTER (WHERE completed_today) AS completed_today,
          COALESCE(MAX(streak), 0) AS best_streak
        FROM life_habits
        WHERE user_id = $1
      `, [userId]),
      db.query(`
        SELECT
          COUNT(*) AS total_vehicles,
          COUNT(*) FILTER (WHERE mileage - last_oil_change_mile >= 4500) AS oil_attention
        FROM user_vehicles
        WHERE user_id = $1
      `, [userId]),
    ]);

    const finances = expenseRes.rows[0] || {};
    const goals = goalsRes.rows[0] || {};
    const home = homeRes.rows[0] || {};
    const sinking = sinkingRes.rows[0] || {};
    const habits = habitsRes.rows[0] || {};
    const vehicles = vehiclesRes.rows[0] || {};

    const income = parseFloat(finances.total_income || 0);
    const expenses = parseFloat(finances.total_expenses || 0);
    const net = income - expenses;
    const activeGoals = parseInt(goals.active_goals || 0, 10);
    const completedGoals = parseInt(goals.completed_goals || 0, 10);
    const overdueTasks = parseInt(home.overdue || 0, 10);
    const dueThisWeek = parseInt(home.due_this_week || 0, 10);
    const totalPending = parseInt(home.total_pending || 0, 10);
    const totalFunds = parseInt(sinking.total_funds || 0, 10);
    const savedAmount = parseFloat(sinking.saved_amount || 0);
    const targetAmount = parseFloat(sinking.target_amount || 0);
    const totalHabits = parseInt(habits.total_habits || 0, 10);
    const completedHabits = parseInt(habits.completed_today || 0, 10);
    const bestStreak = parseInt(habits.best_streak || 0, 10);
    const oilAttention = parseInt(vehicles.oil_attention || 0, 10);

    const hasData = income > 0 || expenses > 0 || activeGoals > 0 || completedGoals > 0
      || totalPending > 0 || totalFunds > 0 || totalHabits > 0 || oilAttention > 0;

    if (!hasData) {
      return res.json({
        overview: 'Your Life Pulse is ready, but it needs a few real entries before it can coach you well.',
        topInsight: 'Add income, one home task, or one goal to unlock a more useful Pulse score.',
        suggestions: [
          'Add your latest income or expense.',
          'Create one home task that needs attention this week.',
          'Start a small sinking fund for an upcoming cost.',
        ],
      });
    }

    const suggestions = [];
    if (net < 0) {
      addSuggestion(suggestions, 'Pick one expense category to trim before adding new goals.');
    } else if (income > 0) {
      addSuggestion(suggestions, 'Move part of this month’s surplus into your highest-priority goal or sinking fund.');
    }
    if (overdueTasks > 0) {
      addSuggestion(suggestions, `Clear ${overdueTasks === 1 ? 'the overdue home task' : `${overdueTasks} overdue home tasks`} before adding new work.`);
    }
    if (oilAttention > 0) {
      addSuggestion(suggestions, 'Schedule vehicle service or post a service job from Car Care.');
    }
    if (totalHabits > 0 && completedHabits < totalHabits) {
      addSuggestion(suggestions, 'Finish one remaining habit today to protect your streak.');
    }
    if (suggestions.length === 0) {
      addSuggestion(suggestions, 'Review your next due date and keep the week focused on one priority.');
    }

    let topInsight = 'Your Life Pulse is balanced, with no urgent blocker standing out right now.';
    if (overdueTasks > 0) {
      topInsight = `${overdueTasks} overdue task${overdueTasks === 1 ? '' : 's'} need attention before your Pulse can feel clean.`;
    } else if (net < 0) {
      topInsight = `Spending is ahead of income by ${currency(Math.abs(net))} this month.`;
    } else if (totalFunds > 0 && targetAmount > 0) {
      const progress = Math.round((savedAmount / Math.max(targetAmount, 1)) * 100);
      topInsight = `Your sinking funds are ${progress}% funded across ${totalFunds} goal${totalFunds === 1 ? '' : 's'}.`;
    } else if (bestStreak > 0) {
      topInsight = `Your strongest habit streak is ${bestStreak} day${bestStreak === 1 ? '' : 's'}.`;
    }

    const overview = [
      `This month you have ${currency(income)} in income and ${currency(expenses)} in expenses, leaving ${currency(net)} net.`,
      `${activeGoals} active goal${activeGoals === 1 ? '' : 's'}, ${totalPending} pending task${totalPending === 1 ? '' : 's'}, and ${completedHabits}/${Math.max(totalHabits, 0)} habit${totalHabits === 1 ? '' : 's'} completed today are shaping your Pulse.`,
      dueThisWeek > 0 ? `${dueThisWeek} task${dueThisWeek === 1 ? ' is' : 's are'} due this week.` : null,
    ].filter(Boolean).join(' ');

    res.json({ overview, topInsight, suggestions });
  } catch (err) {
    logger.error('getPulseInsight error', { message: err.message });
    res.status(500).json({ error: 'Failed to generate Pulse insight.' });
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// DASHBOARD SUMMARY (aggregated endpoint for one-shot dashboard load)
// ═══════════════════════════════════════════════════════════════════════════

exports.getDashboardSummary = async (req, res) => {
  try {
    const userId = req.user.id;
    const now = new Date();
    const month = now.getMonth() + 1;
    const year = now.getFullYear();

    const [expenseRes, goalsRes, homeRes, checklistRes, activityRes, plannedRes] = await Promise.allSettled([
      // Monthly income/expense totals
      db.query(`
        SELECT
          COALESCE(SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END), 0) AS total_income,
          COALESCE(SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END), 0) AS total_expenses
        FROM expenses
        WHERE user_id = $1
          AND EXTRACT(YEAR FROM occurred_at) = $2
          AND EXTRACT(MONTH FROM occurred_at) = $3
      `, [userId, year, month]),

      // Active goals count + progress
      db.query(`
        SELECT
          COUNT(*) FILTER (WHERE NOT is_completed) AS active_goals,
          COUNT(*) FILTER (WHERE is_completed) AS completed_goals,
          ROUND(AVG(
            CASE WHEN target_value > 0 AND NOT is_completed
            THEN LEAST(current_value / target_value * 100, 100)
            ELSE NULL END
          ), 0) AS avg_progress
        FROM goals WHERE user_id = $1
      `, [userId]),

      // Overdue + upcoming home tasks (section='home' only)
      db.query(`
        SELECT
          COUNT(*) FILTER (WHERE NOT is_completed AND due_date < CURRENT_DATE) AS overdue,
          COUNT(*) FILTER (WHERE NOT is_completed AND due_date >= CURRENT_DATE AND due_date <= CURRENT_DATE + INTERVAL '7 days') AS due_this_week,
          COUNT(*) FILTER (WHERE NOT is_completed) AS total_pending
        FROM home_tasks WHERE user_id = $1 AND section = 'home'
      `, [userId]),

      // Checklist stats
      db.query(`
        SELECT
          COUNT(*) AS total,
          COUNT(*) FILTER (WHERE is_completed) AS completed
        FROM checklist_items WHERE user_id = $1
      `, [userId]),

      // Activity: recent jobs, bids, reviews
      db.query(`
        SELECT
          (SELECT COUNT(*) FROM jobs WHERE client_id = $1 AND status IN ('open', 'published', 'in_progress')) AS active_jobs_posted,
          (SELECT COUNT(*) FROM bids WHERE helper_id = $1 AND status = 'pending') AS active_bids,
          (SELECT COUNT(*) FROM jobs WHERE assigned_helper_id = $1 AND status = 'completed') AS jobs_completed,
          (SELECT ROUND(AVG(rating), 1) FROM reviews WHERE reviewee_id = $1) AS avg_rating,
          (SELECT COUNT(*) FROM reviews WHERE reviewee_id = $1) AS review_count
      `, [userId]),

      // Planned needs summary
      db.query(`
        SELECT
          COUNT(*) FILTER (WHERE status IN ('planned','funding','activating_soon'))  AS active_count,
          COUNT(*) FILTER (WHERE status = 'activating_soon')                         AS activating_soon_count,
          COUNT(*) FILTER (WHERE (due_date - lead_time_days) <= CURRENT_DATE + 7
                             AND status IN ('planned','funding','activating_soon'))   AS publishing_this_week,
          COALESCE(SUM(estimated_cost) FILTER (
            WHERE status IN ('planned','funding','activating_soon')), 0)              AS total_planned_cost,
          MIN(due_date) FILTER (WHERE status IN ('planned','funding','activating_soon')) AS next_due_date
        FROM planned_needs
        WHERE user_id = $1
      `, [userId]),
    ]);

    const finances  = expenseRes.status  === 'fulfilled' ? expenseRes.value.rows[0]  : {};
    const goals     = goalsRes.status    === 'fulfilled' ? goalsRes.value.rows[0]    : {};
    const home      = homeRes.status     === 'fulfilled' ? homeRes.value.rows[0]     : {};
    const checklist = checklistRes.status === 'fulfilled' ? checklistRes.value.rows[0] : {};
    const activity  = activityRes.status === 'fulfilled' ? activityRes.value.rows[0] : {};
    const planned   = plannedRes.status  === 'fulfilled' ? plannedRes.value.rows[0]  : {};

    // ── Life Pulse Score (0-100) ──────────────────────────────────────
    // Weighted score across 4 dimensions
    const income = parseFloat(finances.total_income || 0);
    const expenses = parseFloat(finances.total_expenses || 0);
    const net = income - expenses;

    // Detect whether the user has entered ANY financial/activity data at all.
    // If nothing has been input yet, return pulse_score = 0 so the UI never
    // shows a misleading non-zero score to a brand-new user.
    const totalGoalsRaw = parseInt(goals.active_goals || 0) + parseInt(goals.completed_goals || 0);
    const totalPendingRaw = parseInt(home.total_pending || 0);
    const hasAnyData = income > 0 || expenses > 0
      || totalGoalsRaw > 0
      || totalPendingRaw > 0
      || parseInt(activity.jobs_completed || 0) > 0
      || parseInt(activity.active_bids || 0) > 0
      || parseInt(activity.active_jobs_posted || 0) > 0
      || parseFloat(activity.avg_rating || 0) > 0;

    if (!hasAnyData) {
      return res.json({
        pulse_score: 0,
        pulse_breakdown: { finances: 0, goals: 0, home: 0, activity: 0 },
        finances: { total_income: 0, total_expenses: 0, net: 0, month, year },
        goals:    { active: 0, completed: 0, avg_progress: 0 },
        home:     { overdue: 0, due_this_week: 0, total_pending: 0 },
        checklist: { total: 0, completed: 0 },
        activity:  { active_jobs_posted: 0, active_bids: 0, jobs_completed: 0, avg_rating: null },
        planned:   { active_count: 0, activating_soon_count: 0, publishing_this_week: 0, total_planned_cost: 0, next_due_date: null },
      });
    }

    // Finance score (25 pts): positive net = good, deeper negative = worse
    const financeScore = income === 0 && expenses === 0 ? 50 : // neutral if no data
      Math.max(0, Math.min(100, 50 + (net / Math.max(income, expenses, 1)) * 50));

    // Goals score (25 pts): based on avg progress + completion rate
    const goalProgress = parseInt(goals.avg_progress || 0);
    const totalGoals = totalGoalsRaw;
    const goalsScore = totalGoals === 0 ? 50 :
      goalProgress * 0.7 + (parseInt(goals.completed_goals || 0) / totalGoals) * 100 * 0.3;

    // Home score (25 pts): fewer overdue = better
    const overdue = parseInt(home.overdue || 0);
    const totalPending = totalPendingRaw;
    const homeScore = totalPending === 0 ? 80 :
      Math.max(0, 100 - (overdue / Math.max(totalPending, 1)) * 100);

    // Activity score (25 pts): based on jobs, bids, rating
    const rating = parseFloat(activity.avg_rating || 0);
    const jobsCompleted = parseInt(activity.jobs_completed || 0);
    const activityScore = Math.min(100,
      (rating > 0 ? (rating / 5) * 40 : 20) +
      Math.min(jobsCompleted * 5, 30) +
      (parseInt(activity.active_bids || 0) > 0 || parseInt(activity.active_jobs_posted || 0) > 0 ? 30 : 10)
    );

    const pulseScore = Math.round(
      financeScore * 0.25 +
      goalsScore * 0.25 +
      homeScore * 0.25 +
      activityScore * 0.25
    );

    res.json({
      pulse_score: Math.max(0, Math.min(100, pulseScore)),
      pulse_breakdown: {
        finances: Math.round(financeScore),
        goals: Math.round(goalsScore),
        home: Math.round(homeScore),
        activity: Math.round(activityScore),
      },
      finances: {
        total_income: parseFloat(finances.total_income || 0),
        total_expenses: parseFloat(finances.total_expenses || 0),
        net,
        month,
        year,
      },
      goals: {
        active: parseInt(goals.active_goals || 0),
        completed: parseInt(goals.completed_goals || 0),
        avg_progress: parseInt(goals.avg_progress || 0),
      },
      home: {
        overdue: parseInt(home.overdue || 0),
        due_this_week: parseInt(home.due_this_week || 0),
        total_pending: parseInt(home.total_pending || 0),
      },
      checklist: {
        total: parseInt(checklist.total || 0),
        completed: parseInt(checklist.completed || 0),
      },
      activity: {
        active_jobs_posted: parseInt(activity.active_jobs_posted || 0),
        active_bids: parseInt(activity.active_bids || 0),
        jobs_completed: parseInt(activity.jobs_completed || 0),
        avg_rating: parseFloat(activity.avg_rating || 0),
        review_count: parseInt(activity.review_count || 0),
      },
      planned_needs: {
        active_count:          parseInt(planned.active_count || 0),
        activating_soon_count: parseInt(planned.activating_soon_count || 0),
        publishing_this_week:  parseInt(planned.publishing_this_week || 0),
        total_planned_cost:    parseFloat(planned.total_planned_cost || 0),
        next_due_date:         planned.next_due_date || null,
      },
    });
  } catch (err) {
    logger.error('getDashboardSummary error', { message: err.message });
    res.status(500).json({ error: 'Failed to load dashboard summary.' });
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// COMMUNITY STATS (local activity for the area)
// ═══════════════════════════════════════════════════════════════════════════

exports.getCommunityStats = async (req, res) => {
  try {
    const { zip, view } = req.query;
    const zipCondition = zip ? 'AND j.location_zip = $1' : '';
    const zipParams = zip ? [zip] : [];

    // ── Customer view: show marketplace supply-side stats ────────────
    if (view === 'customer') {
      // New helpers who joined this week
      const { rows: newHelperRows } = await db.query(`
        SELECT COUNT(DISTINCT u.id) AS new_helpers_this_week
        FROM users u
        WHERE u.role = 'helper'
          AND u.onboarding_completed = true
          AND u.is_active = true
          AND u.created_at >= CURRENT_DATE - INTERVAL '7 days'
      `);

      // Total active helpers (available to hire)
      const { rows: helperRows } = await db.query(`
        SELECT COUNT(DISTINCT u.id) AS active_helpers
        FROM users u
        WHERE u.role = 'helper'
          AND u.onboarding_completed = true
          AND u.is_active = true
      `);

      // Tool rentals available
      const { rows: toolRows } = await db.query(`
        SELECT COUNT(*) AS tools_for_rent
        FROM tool_rentals
        WHERE status = 'available'
          AND deleted_at IS NULL
      `).catch(() => ({ rows: [{ tools_for_rent: 0 }] }));

      // Marketplace products for sale
      const { rows: productRows } = await db.query(`
        SELECT COUNT(*) AS products_for_sale
        FROM marketplace_products
        WHERE is_active = true
          AND deleted_at IS NULL
      `).catch(() => ({ rows: [{ products_for_sale: 0 }] }));

      // Top service categories (based on active helper profiles)
      const { rows: topCategories } = await db.query(`
        SELECT hp.category AS category_name, COUNT(*) AS helper_count
        FROM helper_profiles hp
        JOIN users u ON u.id = hp.user_id
        WHERE u.is_active = true
          AND u.onboarding_completed = true
          AND hp.category IS NOT NULL
        GROUP BY hp.category
        ORDER BY helper_count DESC
        LIMIT 5
      `).catch(() => ({ rows: [] }));

      return res.json({
        view: 'customer',
        new_helpers_this_week: parseInt(newHelperRows[0]?.new_helpers_this_week || 0),
        active_helpers: parseInt(helperRows[0]?.active_helpers || 0),
        tools_for_rent: parseInt(toolRows[0]?.tools_for_rent || 0),
        products_for_sale: parseInt(productRows[0]?.products_for_sale || 0),
        top_categories: topCategories.map(r => ({ category_name: r.category_name, job_count: r.helper_count })),
      });
    }

    // ── Default (helper/seeker) view ─────────────────────────────────
    const { rows: jobStats } = await db.query(`
      SELECT
        COUNT(*) FILTER (WHERE j.created_at >= CURRENT_DATE - INTERVAL '7 days') AS jobs_this_week,
        COUNT(*) FILTER (WHERE j.status IN ('published', 'matched')) AS open_jobs,
        COUNT(DISTINCT j.client_id) FILTER (WHERE j.created_at >= CURRENT_DATE - INTERVAL '7 days') AS active_seekers
      FROM jobs j
      WHERE j.deleted_at IS NULL
        AND j.status != 'cancelled'
        ${zipCondition}
    `, zipParams);

    // Top categories this month
    const { rows: topCategories } = await db.query(`
      SELECT category_name, COUNT(*) AS job_count
      FROM jobs
      WHERE deleted_at IS NULL
        AND created_at >= CURRENT_DATE - INTERVAL '30 days'
        AND category_name IS NOT NULL
        ${zipCondition}
      GROUP BY category_name
      ORDER BY job_count DESC
      LIMIT 5
    `, zipParams);

    // Active helpers count
    const { rows: helperStats } = await db.query(`
      SELECT
        COUNT(DISTINCT u.id) AS active_helpers
      FROM users u
      WHERE u.role = 'helper'
        AND u.onboarding_completed = true
        AND u.is_active = true
    `);

    res.json({
      view: 'helper',
      jobs_this_week: parseInt(jobStats[0]?.jobs_this_week || 0),
      open_jobs: parseInt(jobStats[0]?.open_jobs || 0),
      active_seekers: parseInt(jobStats[0]?.active_seekers || 0),
      active_helpers: parseInt(helperStats[0]?.active_helpers || 0),
      top_categories: topCategories,
    });
  } catch (err) {
    logger.error('getCommunityStats error', { message: err.message });
    res.status(500).json({ error: 'Failed to fetch community stats.' });
  }
};
