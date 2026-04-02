const db = require('../db');

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

    params.push(parseInt(limit), parseInt(offset));
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
    console.error('getExpenses error:', err);
    res.status(500).json({ error: 'Failed to fetch expenses.' });
  }
};

exports.createExpense = async (req, res) => {
  try {
    const userId = req.user.id;
    const { type = 'expense', amount, category, description, occurred_at } = req.body;

    if (!amount || !category) {
      return res.status(400).json({ error: 'Amount and category are required.' });
    }
    if (!['income', 'expense'].includes(type)) {
      return res.status(400).json({ error: 'Type must be income or expense.' });
    }

    const { rows } = await db.query(`
      INSERT INTO expenses (user_id, type, amount, category, description, occurred_at)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `, [userId, type, amount, category, description || null, occurred_at || new Date()]);

    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('createExpense error:', err);
    res.status(500).json({ error: 'Failed to create expense.' });
  }
};

exports.updateExpense = async (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;
    const { type, amount, category, description, occurred_at } = req.body;

    const { rows } = await db.query(`
      UPDATE expenses
      SET type = COALESCE($3, type),
          amount = COALESCE($4, amount),
          category = COALESCE($5, category),
          description = COALESCE($6, description),
          occurred_at = COALESCE($7, occurred_at),
          updated_at = now()
      WHERE id = $1 AND user_id = $2
      RETURNING *
    `, [id, userId, type, amount, category, description, occurred_at]);

    if (!rows.length) return res.status(404).json({ error: 'Expense not found.' });
    res.json(rows[0]);
  } catch (err) {
    console.error('updateExpense error:', err);
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
    console.error('deleteExpense error:', err);
    res.status(500).json({ error: 'Failed to delete expense.' });
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
    console.error('getExpenseSummary error:', err);
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
    console.error('getBudgets error:', err);
    res.status(500).json({ error: 'Failed to fetch budgets.' });
  }
};

exports.upsertBudget = async (req, res) => {
  try {
    const userId = req.user.id;
    const { category, monthly_limit, color } = req.body;

    if (!category || monthly_limit === undefined) {
      return res.status(400).json({ error: 'Category and monthly_limit are required.' });
    }

    const { rows } = await db.query(`
      INSERT INTO budget_categories (user_id, category, monthly_limit, color)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (user_id, category) DO UPDATE
      SET monthly_limit = $3, color = COALESCE($4, budget_categories.color), updated_at = now()
      RETURNING *
    `, [userId, category, monthly_limit, color || '#F4A261']);

    res.json(rows[0]);
  } catch (err) {
    console.error('upsertBudget error:', err);
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
    console.error('deleteBudget error:', err);
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
    console.error('getGoals error:', err);
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
    console.error('createGoal error:', err);
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
    console.error('updateGoal error:', err);
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
    console.error('deleteGoal error:', err);
    res.status(500).json({ error: 'Failed to delete goal.' });
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
        u.first_name, LEFT(u.last_name, 1) || '.' AS last_name,
        u.avg_rating, u.completed_jobs,
        hp.bio, hp.categories
      FROM saved_helpers sh
      JOIN users u ON u.id = sh.helper_id
      LEFT JOIN helper_profiles hp ON hp.user_id = sh.helper_id
      WHERE sh.user_id = $1
      ORDER BY sh.created_at DESC
    `, [userId]);

    res.json({ saved_helpers: rows });
  } catch (err) {
    console.error('getSavedHelpers error:', err);
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
    console.error('saveHelper error:', err);
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
    console.error('removeSavedHelper error:', err);
    res.status(500).json({ error: 'Failed to remove saved helper.' });
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// HOME TASKS
// ═══════════════════════════════════════════════════════════════════════════

exports.getHomeTasks = async (req, res) => {
  try {
    const userId = req.user.id;
    const { completed } = req.query;

    let condition = 'WHERE user_id = $1';
    if (completed === 'true') condition += ' AND is_completed = true';
    else if (completed === 'false') condition += ' AND is_completed = false';

    const { rows } = await db.query(`
      SELECT * FROM home_tasks
      ${condition}
      ORDER BY
        is_completed ASC,
        CASE urgency WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END,
        due_date ASC NULLS LAST,
        created_at DESC
    `, [userId]);

    res.json({ home_tasks: rows });
  } catch (err) {
    console.error('getHomeTasks error:', err);
    res.status(500).json({ error: 'Failed to fetch home tasks.' });
  }
};

exports.createHomeTask = async (req, res) => {
  try {
    const userId = req.user.id;
    const { title, description, due_date, recurrence_days, urgency = 'low' } = req.body;

    if (!title) return res.status(400).json({ error: 'Title is required.' });

    const { rows } = await db.query(`
      INSERT INTO home_tasks (user_id, title, description, due_date, recurrence_days, urgency)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `, [userId, title, description || null, due_date || null, recurrence_days || null, urgency]);

    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('createHomeTask error:', err);
    res.status(500).json({ error: 'Failed to create home task.' });
  }
};

exports.updateHomeTask = async (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;
    const { title, description, due_date, recurrence_days, urgency, is_completed } = req.body;

    const completedAt = is_completed === true ? 'now()' : 'NULL';

    const { rows } = await db.query(`
      UPDATE home_tasks
      SET title = COALESCE($3, title),
          description = COALESCE($4, description),
          due_date = COALESCE($5, due_date),
          recurrence_days = COALESCE($6, recurrence_days),
          urgency = COALESCE($7, urgency),
          is_completed = COALESCE($8, is_completed),
          completed_at = CASE WHEN $8 = true THEN now() WHEN $8 = false THEN NULL ELSE completed_at END,
          updated_at = now()
      WHERE id = $1 AND user_id = $2
      RETURNING *
    `, [id, userId, title, description, due_date, recurrence_days, urgency, is_completed]);

    if (!rows.length) return res.status(404).json({ error: 'Home task not found.' });
    res.json(rows[0]);
  } catch (err) {
    console.error('updateHomeTask error:', err);
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
    console.error('deleteHomeTask error:', err);
    res.status(500).json({ error: 'Failed to delete home task.' });
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
    console.error('getChecklist error:', err);
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
    console.error('createChecklistItem error:', err);
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
    console.error('updateChecklistItem error:', err);
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
    console.error('deleteChecklistItem error:', err);
    res.status(500).json({ error: 'Failed to delete checklist item.' });
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

    const [expenseRes, goalsRes, homeRes, checklistRes] = await Promise.allSettled([
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

      // Overdue + upcoming home tasks
      db.query(`
        SELECT
          COUNT(*) FILTER (WHERE NOT is_completed AND due_date < CURRENT_DATE) AS overdue,
          COUNT(*) FILTER (WHERE NOT is_completed AND due_date >= CURRENT_DATE AND due_date <= CURRENT_DATE + INTERVAL '7 days') AS due_this_week,
          COUNT(*) FILTER (WHERE NOT is_completed) AS total_pending
        FROM home_tasks WHERE user_id = $1
      `, [userId]),

      // Checklist stats
      db.query(`
        SELECT
          COUNT(*) AS total,
          COUNT(*) FILTER (WHERE is_completed) AS completed
        FROM checklist_items WHERE user_id = $1
      `, [userId]),
    ]);

    const finances = expenseRes.status === 'fulfilled' ? expenseRes.value.rows[0] : {};
    const goals = goalsRes.status === 'fulfilled' ? goalsRes.value.rows[0] : {};
    const home = homeRes.status === 'fulfilled' ? homeRes.value.rows[0] : {};
    const checklist = checklistRes.status === 'fulfilled' ? checklistRes.value.rows[0] : {};

    res.json({
      finances: {
        total_income: parseFloat(finances.total_income || 0),
        total_expenses: parseFloat(finances.total_expenses || 0),
        net: parseFloat(finances.total_income || 0) - parseFloat(finances.total_expenses || 0),
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
    });
  } catch (err) {
    console.error('getDashboardSummary error:', err);
    res.status(500).json({ error: 'Failed to load dashboard summary.' });
  }
};
