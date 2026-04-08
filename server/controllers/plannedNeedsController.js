const db = require('../db');

// ── helpers ────────────────────────────────────────────────────────────────

const VALID_CATEGORIES = ['car_care', 'personal_care', 'other'];
const VALID_STATUSES   = ['planned', 'funding', 'activating_soon', 'published', 'cancelled', 'completed', 'regenerated'];
const VALID_RECURRENCE = ['none', 'fixed', 'floating'];

const WINDOW_DAYS = {
  '1w':  7,
  '2w':  14,
  '1m':  30,
  '3m':  90,
  '6m':  180,
  '1y':  365,
  '5y':  1825,
  '10y': 3650,
};

/** Derive initial status from cost and timing */
function deriveInitialStatus(estimatedCost, dueDateStr, leadTimeDays) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dueDate = new Date(dueDateStr);
  const activationDate = new Date(dueDate);
  activationDate.setDate(activationDate.getDate() - leadTimeDays);

  if (activationDate <= today) return 'activating_soon'; // already within lead time
  if (estimatedCost && parseFloat(estimatedCost) > 0) return 'funding';
  return 'planned';
}

/** Category label → category_name used when auto-posting a job */
function categoryToJobName(category) {
  const map = {
    car_care:      'Auto Repair',
    personal_care: 'General Labor',
    other:         'Other / Specify in Description',
  };
  return map[category] || 'Other / Specify in Description';
}

// ═══════════════════════════════════════════════════════════════════════════
// LIST
// ═══════════════════════════════════════════════════════════════════════════

exports.listPlannedNeeds = async (req, res) => {
  try {
    const userId = req.user.id;
    const { status, category, limit = 100, offset = 0 } = req.query;

    const conditions = ['user_id = $1'];
    const params = [userId];

    if (status) {
      const statuses = status.split(',').filter(s => VALID_STATUSES.includes(s));
      if (statuses.length) {
        params.push(statuses);
        conditions.push(`status = ANY($${params.length})`);
      }
    }
    if (category && VALID_CATEGORIES.includes(category)) {
      params.push(category);
      conditions.push(`category = $${params.length}`);
    }

    params.push(parseInt(limit), parseInt(offset));

    const { rows } = await db.query(`
      SELECT
        pn.*,
        CASE
          WHEN pn.estimated_cost > 0 AND pn.due_date > CURRENT_DATE
          THEN ROUND(
            (pn.estimated_cost - pn.reserved_amount) /
            GREATEST(pn.due_date - CURRENT_DATE, 1)
            * 30, 2
          )
          ELSE 0
        END AS sinking_fund_per_month,
        (pn.due_date - CURRENT_DATE) AS days_until_due,
        (pn.due_date - $2::int) AS activation_date
      FROM planned_needs pn
      WHERE ${conditions.join(' AND ')}
      ORDER BY
        CASE status
          WHEN 'activating_soon' THEN 0
          WHEN 'funding'         THEN 1
          WHEN 'planned'         THEN 2
          WHEN 'published'       THEN 3
          WHEN 'completed'       THEN 4
          WHEN 'cancelled'       THEN 5
          WHEN 'regenerated'     THEN 6
          ELSE 7
        END,
        due_date ASC
      LIMIT $${params.length - 1} OFFSET $${params.length}
    `, params);

    // Re-query without the lead_time trick and compute in JS instead
    const { rows: needs } = await db.query(`
      SELECT
        pn.*,
        (pn.due_date - CURRENT_DATE) AS days_until_due,
        CASE
          WHEN pn.estimated_cost > 0 AND pn.due_date > CURRENT_DATE
          THEN ROUND(
            (pn.estimated_cost - pn.reserved_amount) /
            GREATEST(pn.due_date - CURRENT_DATE, 1)
            * 30, 2
          )
          ELSE 0
        END AS sinking_fund_per_month
      FROM planned_needs pn
      WHERE ${conditions.join(' AND ')}
      ORDER BY
        CASE status
          WHEN 'activating_soon' THEN 0
          WHEN 'funding'         THEN 1
          WHEN 'planned'         THEN 2
          WHEN 'published'       THEN 3
          WHEN 'completed'       THEN 4
          WHEN 'cancelled'       THEN 5
          ELSE 6
        END,
        due_date ASC
      LIMIT $${params.length - 1} OFFSET $${params.length}
    `, params);

    res.json({ planned_needs: needs });
  } catch (err) {
    console.error('listPlannedNeeds error:', err);
    res.status(500).json({ error: 'Failed to fetch planned needs.' });
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// CREATE
// ═══════════════════════════════════════════════════════════════════════════

exports.createPlannedNeed = async (req, res) => {
  try {
    const userId = req.user.id;
    const {
      title,
      description,
      category = 'other',
      due_date,
      estimated_cost,
      lead_time_days = 7,
      recurrence_type = 'none',
      recurrence_interval_days,
      notes,
    } = req.body;

    if (!title)    return res.status(400).json({ error: 'Title is required.' });
    if (!due_date) return res.status(400).json({ error: 'Due date is required.' });
    if (!VALID_CATEGORIES.includes(category)) {
      return res.status(400).json({ error: 'Invalid category.' });
    }
    if (!VALID_RECURRENCE.includes(recurrence_type)) {
      return res.status(400).json({ error: 'Invalid recurrence_type.' });
    }

    const dueDate = new Date(due_date);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (dueDate < today) {
      return res.status(400).json({ error: 'Due date must be in the future.' });
    }

    const status = deriveInitialStatus(estimated_cost, due_date, parseInt(lead_time_days));

    const { rows } = await db.query(`
      INSERT INTO planned_needs
        (user_id, title, description, category, status, due_date, estimated_cost,
         lead_time_days, recurrence_type, recurrence_interval_days, notes)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
      RETURNING *
    `, [
      userId, title, description || null, category, status, due_date,
      estimated_cost || null, parseInt(lead_time_days), recurrence_type,
      recurrence_interval_days || null, notes || null,
    ]);

    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('createPlannedNeed error:', err);
    res.status(500).json({ error: 'Failed to create planned need.' });
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// UPDATE
// ═══════════════════════════════════════════════════════════════════════════

exports.updatePlannedNeed = async (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;
    const {
      title,
      description,
      category,
      due_date,
      estimated_cost,
      lead_time_days,
      recurrence_type,
      recurrence_interval_days,
      reserved_amount,
      notes,
    } = req.body;

    // Verify ownership and editability
    const { rows: existing } = await db.query(
      'SELECT * FROM planned_needs WHERE id = $1 AND user_id = $2',
      [id, userId]
    );
    if (!existing.length) return res.status(404).json({ error: 'Planned need not found.' });

    const need = existing[0];
    if (['published', 'completed', 'cancelled'].includes(need.status)) {
      return res.status(400).json({ error: `Cannot edit a ${need.status} planned need.` });
    }
    if (category && !VALID_CATEGORIES.includes(category)) {
      return res.status(400).json({ error: 'Invalid category.' });
    }
    if (recurrence_type && !VALID_RECURRENCE.includes(recurrence_type)) {
      return res.status(400).json({ error: 'Invalid recurrence_type.' });
    }

    // Re-derive status if cost or lead_time changed
    const newDueDate    = due_date    || need.due_date;
    const newCost       = estimated_cost !== undefined ? estimated_cost : need.estimated_cost;
    const newLeadTime   = lead_time_days !== undefined ? lead_time_days : need.lead_time_days;
    const newStatus     = deriveInitialStatus(newCost, newDueDate, parseInt(newLeadTime));

    const { rows } = await db.query(`
      UPDATE planned_needs
      SET title                    = COALESCE($3,  title),
          description              = COALESCE($4,  description),
          category                 = COALESCE($5,  category),
          status                   = $6,
          due_date                 = COALESCE($7,  due_date),
          estimated_cost           = COALESCE($8,  estimated_cost),
          lead_time_days           = COALESCE($9,  lead_time_days),
          recurrence_type          = COALESCE($10, recurrence_type),
          recurrence_interval_days = COALESCE($11, recurrence_interval_days),
          reserved_amount          = COALESCE($12, reserved_amount),
          notes                    = COALESCE($13, notes),
          updated_at               = NOW()
      WHERE id = $1 AND user_id = $2
      RETURNING *
    `, [
      id, userId, title, description, category, newStatus, due_date,
      estimated_cost, lead_time_days, recurrence_type,
      recurrence_interval_days, reserved_amount, notes,
    ]);

    res.json(rows[0]);
  } catch (err) {
    console.error('updatePlannedNeed error:', err);
    res.status(500).json({ error: 'Failed to update planned need.' });
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// CANCEL
// ═══════════════════════════════════════════════════════════════════════════

exports.cancelPlannedNeed = async (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;

    const { rows: existing } = await db.query(
      'SELECT * FROM planned_needs WHERE id = $1 AND user_id = $2',
      [id, userId]
    );
    if (!existing.length) return res.status(404).json({ error: 'Planned need not found.' });
    if (existing[0].status === 'cancelled') {
      return res.status(400).json({ error: 'Already cancelled.' });
    }
    if (existing[0].status === 'completed') {
      return res.status(400).json({ error: 'Cannot cancel a completed need.' });
    }

    const { rows } = await db.query(`
      UPDATE planned_needs
      SET status = 'cancelled', cancelled_at = NOW(), updated_at = NOW()
      WHERE id = $1 AND user_id = $2
      RETURNING *
    `, [id, userId]);

    res.json(rows[0]);
  } catch (err) {
    console.error('cancelPlannedNeed error:', err);
    res.status(500).json({ error: 'Failed to cancel planned need.' });
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// COMPLETE
// ═══════════════════════════════════════════════════════════════════════════

exports.completePlannedNeed = async (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;
    const { actual_cost } = req.body;

    const { rows: existing } = await db.query(
      'SELECT * FROM planned_needs WHERE id = $1 AND user_id = $2',
      [id, userId]
    );
    if (!existing.length) return res.status(404).json({ error: 'Planned need not found.' });

    const need = existing[0];
    if (['cancelled', 'completed'].includes(need.status)) {
      return res.status(400).json({ error: `Cannot complete a ${need.status} need.` });
    }

    // Mark complete
    const { rows } = await db.query(`
      UPDATE planned_needs
      SET status = 'completed',
          actual_cost = COALESCE($3, actual_cost),
          completed_at = NOW(),
          updated_at = NOW()
      WHERE id = $1 AND user_id = $2
      RETURNING *
    `, [id, userId, actual_cost || null]);

    const completed = rows[0];
    let nextNeed = null;

    // Auto-regenerate if recurring
    if (need.recurrence_type !== 'none' && need.recurrence_interval_days) {
      const completedAt = new Date();
      let nextDueDate;

      if (need.recurrence_type === 'floating') {
        // Next due = completion date + interval
        nextDueDate = new Date(completedAt);
        nextDueDate.setDate(nextDueDate.getDate() + need.recurrence_interval_days);
      } else {
        // fixed: next due = original due_date + interval
        nextDueDate = new Date(need.due_date);
        nextDueDate.setDate(nextDueDate.getDate() + need.recurrence_interval_days);
      }

      const nextDueDateStr = nextDueDate.toISOString().split('T')[0];
      const nextStatus = deriveInitialStatus(need.estimated_cost, nextDueDateStr, need.lead_time_days);

      const { rows: nextRows } = await db.query(`
        INSERT INTO planned_needs
          (user_id, title, description, category, status, due_date, estimated_cost,
           lead_time_days, recurrence_type, recurrence_interval_days, notes, parent_need_id)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
        RETURNING *
      `, [
        userId, need.title, need.description, need.category, nextStatus,
        nextDueDateStr, need.estimated_cost, need.lead_time_days,
        need.recurrence_type, need.recurrence_interval_days, need.notes, need.id,
      ]);
      nextNeed = nextRows[0];

      // Mark original as 'regenerated' for clarity
      await db.query(
        "UPDATE planned_needs SET status = 'regenerated', updated_at = NOW() WHERE id = $1",
        [id]
      );
    }

    res.json({ completed, next_need: nextNeed });
  } catch (err) {
    console.error('completePlannedNeed error:', err);
    res.status(500).json({ error: 'Failed to complete planned need.' });
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// DELETE (hard delete — only allowed for planned/funding)
// ═══════════════════════════════════════════════════════════════════════════

exports.deletePlannedNeed = async (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;

    const { rows: existing } = await db.query(
      'SELECT status FROM planned_needs WHERE id = $1 AND user_id = $2',
      [id, userId]
    );
    if (!existing.length) return res.status(404).json({ error: 'Planned need not found.' });

    if (!['planned', 'funding'].includes(existing[0].status)) {
      return res.status(400).json({ error: 'Only planned or funding needs can be deleted. Use cancel instead.' });
    }

    await db.query('DELETE FROM planned_needs WHERE id = $1 AND user_id = $2', [id, userId]);
    res.json({ message: 'Planned need deleted.' });
  } catch (err) {
    console.error('deletePlannedNeed error:', err);
    res.status(500).json({ error: 'Failed to delete planned need.' });
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// LIFE PULSE PROJECTION
// ═══════════════════════════════════════════════════════════════════════════

exports.getProjection = async (req, res) => {
  try {
    const userId = req.user.id;
    const windowKey = req.query.window || '1m';
    const windowDays = WINDOW_DAYS[windowKey];

    if (!windowDays) {
      return res.status(400).json({
        error: `Invalid window. Valid values: ${Object.keys(WINDOW_DAYS).join(', ')}`,
      });
    }

    // ── Average daily income/expense from last 90 days ─────────────────
    const { rows: avgRows } = await db.query(`
      SELECT
        COALESCE(SUM(CASE WHEN type = 'income'  THEN amount ELSE 0 END), 0) / 90 AS avg_daily_income,
        COALESCE(SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END), 0) / 90 AS avg_daily_expense
      FROM expenses
      WHERE user_id = $1
        AND occurred_at >= CURRENT_DATE - INTERVAL '90 days'
    `, [userId]);

    const avgDailyIncome  = parseFloat(avgRows[0].avg_daily_income  || 0);
    const avgDailyExpense = parseFloat(avgRows[0].avg_daily_expense || 0);

    // ── Active planned needs ────────────────────────────────────────────
    const { rows: needs } = await db.query(`
      SELECT
        id, title, category, status, due_date, estimated_cost,
        reserved_amount, lead_time_days,
        (due_date - CURRENT_DATE) AS days_until_due
      FROM planned_needs
      WHERE user_id = $1
        AND status IN ('planned', 'funding', 'activating_soon')
        AND due_date >= CURRENT_DATE
      ORDER BY due_date ASC
    `, [userId]);

    // ── Sinking fund math per need ─────────────────────────────────────
    // For each need: how much of the estimated_cost falls within this window?
    // Formula: daily_contribution = (cost - reserved) / days_until_due
    //          window_cost = daily_contribution * min(window_days, days_until_due)
    let totalSinkingFundForWindow = 0;
    let autoPublishingCount = 0;

    const needsWithProjection = needs.map(need => {
      const daysUntilDue  = Math.max(0, parseInt(need.days_until_due || 0));
      const cost          = parseFloat(need.estimated_cost || 0);
      const reserved      = parseFloat(need.reserved_amount || 0);
      const remaining     = Math.max(0, cost - reserved);
      const daysToFund    = Math.max(daysUntilDue, 1);
      const dailyContrib  = remaining / daysToFund;
      const daysInWindow  = Math.min(windowDays, daysUntilDue);
      const windowCost    = dailyContrib * daysInWindow;
      const monthlyContrib = dailyContrib * 30;

      totalSinkingFundForWindow += windowCost;

      const activationDays = daysUntilDue - parseInt(need.lead_time_days || 7);
      const isActivatingSoon = activationDays <= windowDays;
      if (isActivatingSoon) autoPublishingCount++;

      return {
        id:                need.id,
        title:             need.title,
        category:          need.category,
        status:            need.status,
        due_date:          need.due_date,
        estimated_cost:    cost,
        reserved_amount:   reserved,
        days_until_due:    daysUntilDue,
        sinking_fund_per_month: Math.round(monthlyContrib * 100) / 100,
        window_cost:       Math.round(windowCost * 100) / 100,
        funding_pct:       cost > 0 ? Math.min(100, Math.round((reserved / cost) * 100)) : 0,
        activates_in_days: activationDays,
        is_activating_soon: isActivatingSoon,
      };
    });

    // ── Window projections ─────────────────────────────────────────────
    const projectedIncome   = Math.round(avgDailyIncome  * windowDays * 100) / 100;
    const projectedExpenses = Math.round(avgDailyExpense * windowDays * 100) / 100;
    const totalPlannedCost  = Math.round(totalSinkingFundForWindow * 100) / 100;
    const netAvailable      = Math.round((projectedIncome - projectedExpenses - totalPlannedCost) * 100) / 100;
    const denominator       = projectedExpenses + totalPlannedCost;
    const coverageRatio     = denominator > 0
      ? Math.round((projectedIncome / denominator) * 100) / 100
      : null;

    res.json({
      window:          windowKey,
      window_days:     windowDays,
      avg_daily_income:  Math.round(avgDailyIncome  * 100) / 100,
      avg_daily_expense: Math.round(avgDailyExpense * 100) / 100,
      projected_income:  projectedIncome,
      projected_fixed_expenses: projectedExpenses,
      sinking_fund_for_window:  totalPlannedCost,
      net_available:     netAvailable,
      coverage_ratio:    coverageRatio,
      auto_publishing_in_window: autoPublishingCount,
      needs: needsWithProjection,
    });
  } catch (err) {
    console.error('getProjection error:', err);
    res.status(500).json({ error: 'Failed to generate projection.' });
  }
};
