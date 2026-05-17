const pool = require('../db');

exports.listRecurring = async (req, res, next) => {
  const { businessId } = req.params;
  try {
    const rows = await pool.query(
      `SELECT rb.*, c.name AS client_name, c.email AS client_email
       FROM business_recurring_billing rb
       LEFT JOIN business_customers c ON rb.customer_id = c.id
       WHERE rb.business_id = $1 ORDER BY rb.created_at DESC`,
      [businessId]
    );
    res.json(rows.rows);
  } catch (err) { next(err); }
};

exports.createRecurring = async (req, res, next) => {
  const { businessId } = req.params;
  const { customer_id, description, amount_cents, frequency, start_date, notes } = req.body;
  if (!amount_cents || !frequency || !start_date) {
    return res.status(400).json({ error: 'amount_cents, frequency, and start_date are required' });
  }
  try {
    const row = await pool.query(
      `INSERT INTO business_recurring_billing (business_id, customer_id, description, amount_cents, frequency, next_billing_date, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [businessId, customer_id, description, amount_cents, frequency, start_date, notes]
    );
    res.status(201).json(row.rows[0]);
  } catch (err) { next(err); }
};

exports.updateRecurring = async (req, res, next) => {
  const { businessId, billingId } = req.params;
  const { description, amount_cents, frequency, next_billing_date, status, notes } = req.body;
  try {
    const row = await pool.query(
      `UPDATE business_recurring_billing SET description=$1, amount_cents=$2, frequency=$3,
       next_billing_date=$4, status=COALESCE($5,status), notes=$6, updated_at=NOW()
       WHERE id=$7 AND business_id=$8 RETURNING *`,
      [description, amount_cents, frequency, next_billing_date, status, notes, billingId, businessId]
    );
    if (!row.rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(row.rows[0]);
  } catch (err) { next(err); }
};

exports.deleteRecurring = async (req, res, next) => {
  const { businessId, billingId } = req.params;
  try {
    await pool.query('DELETE FROM business_recurring_billing WHERE id=$1 AND business_id=$2', [billingId, businessId]);
    res.json({ success: true });
  } catch (err) { next(err); }
};
