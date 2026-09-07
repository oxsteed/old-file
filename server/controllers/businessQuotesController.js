const pool = require('../db');
const crypto = require('crypto');

exports.listQuotes = async (req, res, next) => {
  const { businessId } = req.params;
  const { status, limit = 20, offset = 0 } = req.query;
  try {
    let where = 'WHERE business_id = $1';
    const params = [businessId];
    if (status) { where += ' AND status = $2'; params.push(status); }
    const rows = await pool.query(
      `SELECT * FROM business_quotes ${where} ORDER BY created_at DESC LIMIT $${params.length+1} OFFSET $${params.length+2}`,
      [...params, parseInt(limit), parseInt(offset)]
    );
    const total = await pool.query(`SELECT COUNT(*) FROM business_quotes ${where}`, params);
    res.json({ quotes: rows.rows, total: parseInt(total.rows[0].count) });
  } catch (err) { next(err); }
};

exports.getQuote = async (req, res, next) => {
  const { businessId, id: quoteId } = req.params;
  try {
    const row = await pool.query(
      'SELECT * FROM business_quotes WHERE id=$1 AND business_id=$2', [quoteId, businessId]
    );
    if (!row.rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(row.rows[0]);
  } catch (err) { next(err); }
};

exports.getQuoteByToken = async (req, res, next) => {
  const { token } = req.params;
  try {
    const row = await pool.query(
      `SELECT id, client_name, title, description, line_items, subtotal_cents,
              tax_rate, total_cents, status, valid_until, created_at, updated_at
         FROM business_quotes
        WHERE token = $1`,
      [token]
    );
    if (!row.rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(row.rows[0]);
  } catch (err) { next(err); }
};

exports.createQuote = async (req, res, next) => {
  const { businessId } = req.params;
  const { client_name, client_email, title, line_items, tax_rate, valid_until } = req.body;
  if (!client_name || !title || !line_items) {
    return res.status(400).json({ error: 'client_name, title, and line_items are required' });
  }
  try {
    const subtotal = (line_items || []).reduce((s, i) => s + (i.quantity * i.unit_price_cents), 0);
    const tax = Math.round(subtotal * (tax_rate || 0) / 100);
    const total = subtotal + tax;
    const token = crypto.randomBytes(16).toString('hex');
    const row = await pool.query(
      `INSERT INTO business_quotes (business_id, client_name, client_email, title, line_items, subtotal_cents, tax_rate, total_cents, valid_until, token)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [businessId, client_name, client_email, title, JSON.stringify(line_items), subtotal, tax_rate || 0, total, valid_until, token]
    );
    res.status(201).json(row.rows[0]);
  } catch (err) { next(err); }
};

exports.updateQuote = async (req, res, next) => {
  const { businessId, id: quoteId } = req.params;
  const { client_name, client_email, title, line_items, tax_rate, valid_until, status } = req.body;
  try {
    const subtotal = (line_items || []).reduce((s, i) => s + (i.quantity * i.unit_price_cents), 0);
    const tax = Math.round(subtotal * (tax_rate || 0) / 100);
    const total = subtotal + tax;
    const row = await pool.query(
      `UPDATE business_quotes SET client_name=$1, client_email=$2, title=$3, line_items=$4,
       subtotal_cents=$5, tax_rate=$6, total_cents=$7, valid_until=$8, status=COALESCE($9,status), updated_at=NOW()
       WHERE id=$10 AND business_id=$11 RETURNING *`,
      [client_name, client_email, title, JSON.stringify(line_items), subtotal, tax_rate||0, total, valid_until, status, quoteId, businessId]
    );
    if (!row.rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(row.rows[0]);
  } catch (err) { next(err); }
};

exports.sendQuote = async (req, res, next) => {
  const { businessId, id: quoteId } = req.params;
  try {
    const row = await pool.query(
      `UPDATE business_quotes SET status='sent', updated_at=NOW() WHERE id=$1 AND business_id=$2 AND status='draft' RETURNING *`,
      [quoteId, businessId]
    );
    if (!row.rows.length) return res.status(404).json({ error: 'Not found or not in draft status' });
    res.json(row.rows[0]);
  } catch (err) { next(err); }
};

exports.respondToQuote = async (req, res, next) => {
  const { token } = req.params;
  const { response } = req.body; // 'approved' or 'declined'
  if (!['approved','declined'].includes(response)) {
    return res.status(400).json({ error: 'response must be approved or declined' });
  }
  try {
    const row = await pool.query(
      `UPDATE business_quotes
          SET status = $1, updated_at = NOW()
        WHERE token = $2
          AND status = 'sent'
          AND (valid_until IS NULL OR valid_until >= CURRENT_DATE)
        RETURNING id, client_name, title, description, line_items, subtotal_cents,
                  tax_rate, total_cents, status, valid_until, created_at, updated_at`,
      [response, token]
    );
    if (!row.rows.length) return res.status(404).json({ error: 'Quote not found or already responded' });
    res.json(row.rows[0]);
  } catch (err) { next(err); }
};

exports.deleteQuote = async (req, res, next) => {
  const { businessId, id: quoteId } = req.params;
  try {
    await pool.query('DELETE FROM business_quotes WHERE id=$1 AND business_id=$2', [quoteId, businessId]);
    res.json({ success: true });
  } catch (err) { next(err); }
};

exports.convertToInvoice = async (req, res, next) => {
  const { businessId, id: quoteId } = req.params;
  try {
    const quoteRow = await pool.query(
      'SELECT * FROM business_quotes WHERE id=$1 AND business_id=$2',
      [quoteId, businessId]
    );
    if (!quoteRow.rows.length) return res.status(404).json({ error: 'Quote not found' });
    const quote = quoteRow.rows[0];
    if (!['approved', 'sent'].includes(quote.status)) {
      return res.status(400).json({ error: 'Only approved or sent quotes can be converted to invoices' });
    }
    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + 30);
    const invoiceRow = await pool.query(
      `INSERT INTO business_invoices
         (business_id, client_name, client_email, title, line_items,
          subtotal_cents, tax_rate, total_cents, due_date, status, quote_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'draft',$10) RETURNING *`,
      [
        businessId, quote.client_name, quote.client_email, quote.title,
        quote.line_items, quote.subtotal_cents, quote.tax_rate,
        quote.total_cents, dueDate, quoteId,
      ]
    );
    await pool.query(
      "UPDATE business_quotes SET status='converted', updated_at=NOW() WHERE id=$1",
      [quoteId]
    );
    res.status(201).json(invoiceRow.rows[0]);
  } catch (err) { next(err); }
};
