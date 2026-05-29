const pool = require('../db');

exports.listExpenses = async (req, res, next) => {
  const { businessId } = req.params;
  const { category, from, to, limit = 50, offset = 0 } = req.query;
  try {
    let where = 'WHERE business_id = $1';
    const params = [businessId];
    let p = 2;
    if (category) { where += ` AND category = $${p++}`; params.push(category); }
    if (from)     { where += ` AND expense_date >= $${p++}`; params.push(from); }
    if (to)       { where += ` AND expense_date <= $${p++}`; params.push(to); }
    const rows = await pool.query(
      `SELECT * FROM business_expenses ${where} ORDER BY expense_date DESC LIMIT $${p} OFFSET $${p+1}`,
      [...params, parseInt(limit), parseInt(offset)]
    );
    const total = await pool.query(`SELECT COUNT(*) FROM business_expenses ${where}`, params);
    const summary = await pool.query(
      `SELECT category, SUM(amount_cents) AS total_cents FROM business_expenses WHERE business_id = $1 GROUP BY category`,
      [businessId]
    );
    res.json({ expenses: rows.rows, total: parseInt(total.rows[0].count), summary: summary.rows });
  } catch (err) { next(err); }
};

exports.createExpense = async (req, res, next) => {
  const { businessId } = req.params;
  const { category, description, amount_cents, expense_date, receipt_url, notes } = req.body;
  if (!category || !amount_cents || !expense_date) {
    return res.status(400).json({ error: 'category, amount_cents, and expense_date are required' });
  }
  try {
    const row = await pool.query(
      `INSERT INTO business_expenses (business_id, category, description, amount_cents, expense_date, receipt_url, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [businessId, category, description, amount_cents, expense_date, receipt_url, notes, req.user.id]
    );
    res.status(201).json(row.rows[0]);
  } catch (err) { next(err); }
};

exports.updateExpense = async (req, res, next) => {
  const { businessId, id: expenseId } = req.params;
  const { category, description, amount_cents, expense_date, receipt_url, notes } = req.body;
  try {
    const row = await pool.query(
      `UPDATE business_expenses SET category=$1, description=$2, amount_cents=$3, expense_date=$4,
       receipt_url=$5, notes=$6, updated_at=NOW()
       WHERE id=$7 AND business_id=$8 RETURNING *`,
      [category, description, amount_cents, expense_date, receipt_url, notes, expenseId, businessId]
    );
    if (!row.rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(row.rows[0]);
  } catch (err) { next(err); }
};

exports.deleteExpense = async (req, res, next) => {
  const { businessId, id: expenseId } = req.params;
  try {
    await pool.query('DELETE FROM business_expenses WHERE id=$1 AND business_id=$2', [expenseId, businessId]);
    res.json({ success: true });
  } catch (err) { next(err); }
};
