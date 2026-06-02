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
  const { businessId, id: billingId } = req.params;
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
  const { businessId, id: billingId } = req.params;
  try {
    await pool.query('DELETE FROM business_recurring_billing WHERE id=$1 AND business_id=$2', [billingId, businessId]);
    res.json({ success: true });
  } catch (err) { next(err); }
};

exports.toggleStatus = async (req, res, next) => {
  const { businessId, id: billingId } = req.params;
  try {
    const row = await pool.query(
      `UPDATE business_recurring_billing
       SET status = CASE WHEN status = 'active' THEN 'paused' ELSE 'active' END,
           updated_at = NOW()
       WHERE id=$1 AND business_id=$2 RETURNING *`,
      [billingId, businessId]
    );
    if (!row.rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(row.rows[0]);
  } catch (err) { next(err); }
};

exports.generateInvoice = async (req, res, next) => {
  const { businessId, id: billingId } = req.params;
  try {
    const billingRow = await pool.query(
      'SELECT * FROM business_recurring_billing WHERE id=$1 AND business_id=$2',
      [billingId, businessId]
    );
    if (!billingRow.rows.length) return res.status(404).json({ error: 'Not found' });
    const billing = billingRow.rows[0];

    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + 14);

    const lineItems = JSON.stringify([{
      description: billing.description || 'Recurring service',
      quantity: 1,
      unit_price_cents: billing.amount_cents,
    }]);

    const invoiceRow = await pool.query(
      `INSERT INTO business_invoices
         (business_id, client_name, title, line_items,
          subtotal_cents, tax_rate, total_cents, due_date, status, recurring_billing_id)
       VALUES ($1,
               COALESCE((SELECT name FROM business_customers WHERE id=$2), 'Customer'),
               $3, $4, $5, 0, $5, $6, 'draft', $7)
       RETURNING *`,
      [
        businessId, billing.customer_id,
        billing.description || 'Recurring Invoice',
        lineItems, billing.amount_cents, dueDate, billingId,
      ]
    );

    // Advance next_billing_date by one period
    const freqMap = { daily: 1, weekly: 7, biweekly: 14, monthly: 30, quarterly: 90, yearly: 365, annually: 365 };
    const days = freqMap[billing.frequency] || 30;
    await pool.query(
      `UPDATE business_recurring_billing
       SET next_billing_date = COALESCE(next_billing_date, NOW()) + INTERVAL '${days} days',
           updated_at = NOW()
       WHERE id=$1`,
      [billingId]
    );

    res.status(201).json(invoiceRow.rows[0]);
  } catch (err) { next(err); }
};
