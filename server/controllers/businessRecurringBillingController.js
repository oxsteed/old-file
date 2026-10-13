const { randomUUID } = require('crypto');
const pool = require('../db');
const { withTransaction } = require('../utils/transaction');

const VALID_FREQUENCIES = new Set(['weekly', 'biweekly', 'monthly', 'quarterly', 'annually']);
const VALID_STATUSES = new Set(['active', 'paused', 'cancelled']);

function normalizeAmount(value) {
  const amount = Number(value);
  return Number.isSafeInteger(amount) && amount > 0 && amount <= 1000000000 ? amount : null;
}

function normalizeDate(value) {
  const date = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const parsed = new Date(`${date}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date ? null : date;
}

function normalizeFrequency(value) {
  if (value === 'yearly') return 'annually';
  return VALID_FREQUENCIES.has(value) ? value : null;
}

exports.listRecurring = async (req, res, next) => {
  const { businessId } = req.params;
  const { status } = req.query;
  try {
    const params = [businessId];
    const statusClause = status ? ` AND rb.status = $${params.push(status)}` : '';
    const rows = await pool.query(
      `SELECT rb.*
       FROM business_recurring_billing rb
       WHERE rb.business_id = $1${statusClause} ORDER BY rb.created_at DESC`,
      params
    );
    // Keep the original array response used by the active Business Hub manager.
    res.json(rows.rows);
  } catch (err) { next(err); }
};

exports.createRecurring = async (req, res, next) => {
  const { businessId } = req.params;
  const {
    client_name, client_email, description, amount_cents, frequency,
    start_date, next_billing_date, notes,
  } = req.body;
  const amount = normalizeAmount(amount_cents);
  const billingDate = normalizeDate(next_billing_date || start_date);
  const normalizedFrequency = normalizeFrequency(frequency);
  if (!String(client_name || '').trim() || !description?.trim() || !amount || !normalizedFrequency || !billingDate) {
    return res.status(400).json({ error: 'client_name, description, positive amount_cents, valid frequency, and billing date are required' });
  }
  try {
    const row = await pool.query(
      `INSERT INTO business_recurring_billing
         (business_id, client_name, client_email, description, amount_cents, frequency, next_billing_date, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [businessId, client_name.trim(), client_email || null, description.trim(), amount, normalizedFrequency, billingDate, notes || null, req.user?.id || null]
    );
    res.status(201).json(row.rows[0]);
  } catch (err) { next(err); }
};

exports.updateRecurring = async (req, res, next) => {
  const { businessId, id: billingId } = req.params;
  const { client_name, client_email, description, amount_cents, frequency, next_billing_date, start_date, status, notes } = req.body;
  const amount = amount_cents === undefined ? null : normalizeAmount(amount_cents);
  const billingDate = next_billing_date === undefined && start_date === undefined
    ? null
    : normalizeDate(next_billing_date || start_date);
  if (client_name !== undefined && !String(client_name || '').trim()) return res.status(400).json({ error: 'client_name cannot be empty' });
  if (description !== undefined && !String(description || '').trim()) return res.status(400).json({ error: 'description cannot be empty' });
  if (amount_cents !== undefined && !amount) return res.status(400).json({ error: 'amount_cents must be a positive integer' });
  const normalizedFrequency = frequency === undefined ? null : normalizeFrequency(frequency);
  if (frequency !== undefined && !normalizedFrequency) return res.status(400).json({ error: 'Invalid frequency' });
  if ((next_billing_date !== undefined || start_date !== undefined) && !billingDate) return res.status(400).json({ error: 'Invalid billing date' });
  if (status !== undefined && !VALID_STATUSES.has(status)) return res.status(400).json({ error: 'Invalid status' });
  try {
    const row = await pool.query(
      `UPDATE business_recurring_billing SET
       client_name=COALESCE($1, client_name), client_email=COALESCE($2, client_email),
       description=COALESCE($3, description), amount_cents=COALESCE($4, amount_cents),
       frequency=COALESCE($5, frequency), next_billing_date=COALESCE($6, next_billing_date),
       status=COALESCE($7,status), notes=COALESCE($8, notes), updated_at=NOW()
       WHERE id=$9 AND business_id=$10 RETURNING *`,
      [client_name === undefined ? null : client_name.trim(), client_email === undefined ? null : client_email || null,
        description === undefined ? null : description.trim(), amount, normalizedFrequency, billingDate, status || null,
        notes === undefined ? null : notes, billingId, businessId]
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
    const generated = await withTransaction(pool, async (client) => {
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`recurring-invoice:${billingId}`]);
      const billingRow = await client.query(
        'SELECT * FROM business_recurring_billing WHERE id=$1 AND business_id=$2 FOR UPDATE',
        [billingId, businessId]
      );
      if (!billingRow.rows.length) return { missing: true };
      const billing = billingRow.rows[0];

      // Advance next_billing_date by one period (moved up: the duplicate
      // guards below need the period length).
      const freqMap = { weekly: 7, biweekly: 14, monthly: 30, quarterly: 90, annually: 365 };
      const days = freqMap[billing.frequency] || 30;

      // Per-billing-period duplicate guard (P3-9-F04). The invoice bills the
      // period ending on the current next_billing_date; the period start is
      // derived in SQL so the guard and the INSERT below agree exactly. A
      // retry after the first call advanced next_billing_date resolves to
      // the same period start, so it replays instead of minting a second
      // invoice for the period (or billing the next period early).
      const periodRow = await client.query(
        `SELECT (COALESCE($1::date, CURRENT_DATE) - make_interval(days => $2))::date AS period_start`,
        [billing.next_billing_date, days]
      );
      const periodStart = periodRow.rows[0].period_start;
      const periodDuplicate = await client.query(
        `SELECT * FROM business_invoices
         WHERE recurring_billing_id = $1 AND billing_period_start = $2::date AND status <> 'cancelled'
         LIMIT 1`,
        [billingId, periodStart]
      );
      if (periodDuplicate.rows[0]) return { invoice: periodDuplicate.rows[0], replay: true };

      // Legacy same-day guard: covers invoices minted before the period
      // columns existed (NULL recurring_billing_id) during rollout.
      const duplicate = await client.query(
        `SELECT * FROM business_invoices
         WHERE business_id = $1 AND notes = $2 AND status <> 'cancelled'
           AND created_at >= date_trunc('day', NOW())
         ORDER BY created_at DESC LIMIT 1`,
        [businessId, `Generated from recurring billing ${billingId}`]
      );
      if (duplicate.rows[0]) return { invoice: duplicate.rows[0], replay: true };

      const businessRow = await client.query(
        `UPDATE businesses SET invoice_seq = invoice_seq + 1
         WHERE id = $1 RETURNING invoice_seq, user_id`,
        [businessId]
      );
      if (!businessRow.rows.length) return { businessMissing: true };

    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + 14);
    const invoiceNumber = `INV-${new Date().getFullYear()}-${String(businessRow.rows[0].invoice_seq).padStart(4, '0')}`;
    const amount = Number(billing.amount_cents) / 100;

    const lineItems = JSON.stringify([{
      description: billing.description || 'Recurring service',
      quantity: 1,
      unit_price: amount,
      amount,
    }]);

    const publicToken = randomUUID();
    const invoiceRow = await client.query(
      `INSERT INTO business_invoices
         (user_id, business_id, invoice_number, client_name, client_email,
          status, due_date, subtotal, invoice_tax_rate, tax_amount, total, line_items, notes, public_token,
          recurring_billing_id, billing_period_start)
       VALUES ($1,$2,$3,$4,$5,'draft',$6,$7,0,0,$7,$8,$9,$10,$11,$12)
       RETURNING *`,
      [
        businessRow.rows[0].user_id, businessId, invoiceNumber,
        billing.client_name, billing.client_email, dueDate, amount,
        lineItems, `Generated from recurring billing ${billingId}`,
        publicToken, billingId, periodStart,
      ]
    );

    // Advance next_billing_date by one period
    await client.query(
      `UPDATE business_recurring_billing
       SET next_billing_date = COALESCE(next_billing_date, NOW()) + INTERVAL '${days} days',
           updated_at = NOW()
       WHERE id=$1`,
      [billingId]
    );

      return { invoice: invoiceRow.rows[0], replay: false };
    }, 'generate_recurring_invoice');
    if (generated.missing) return res.status(404).json({ error: 'Not found' });
    if (generated.businessMissing) return res.status(404).json({ error: 'Business not found' });
    res.status(generated.replay ? 200 : 201).json(generated.invoice);
  } catch (err) { next(err); }
};
