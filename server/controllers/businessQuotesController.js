const pool = require('../db');
const crypto = require('crypto');

const VALID_STATUSES = new Set(['draft', 'sent', 'approved', 'declined', 'expired', 'converted']);

function normalizeLineItems(value) {
  if (!Array.isArray(value) || value.length === 0 || value.length > 100) {
    return { error: 'At least one line item is required' };
  }

  const items = value.map((item) => {
    const quantity = Number(item?.quantity);
    const unitPriceCents = item?.unit_price_cents !== undefined
      ? Number(item.unit_price_cents)
      : Math.round(Number(item?.unit_price) * 100);
    const description = String(item?.description || '').trim();
    if (!description || description.length > 500
      || !Number.isFinite(quantity) || quantity <= 0 || quantity > 1000000
      || !Number.isFinite(unitPriceCents) || !Number.isInteger(unitPriceCents)
      || unitPriceCents < 0 || unitPriceCents > 100000000) {
      return null;
    }
    return {
      ...item,
      description,
      quantity,
      unit_price: unitPriceCents / 100,
      unit_price_cents: unitPriceCents,
    };
  });

  if (items.some((item) => !item)) return { error: 'Each line item needs a description, positive quantity, and valid price' };
  return { items };
}

function normalizeTaxRate(value) {
  const taxRate = Number(value);
  if (!Number.isFinite(taxRate) || taxRate < 0 || taxRate > 100) return null;
  return Math.round(taxRate * 100) / 100;
}

function calculateTotals(lineItems, taxRate) {
  const subtotal = Math.round(lineItems.reduce(
    (sum, item) => sum + item.quantity * item.unit_price_cents,
    0
  ));
  const tax = Math.round(subtotal * taxRate / 100);
  return { subtotal, tax, total: subtotal + tax };
}

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

  const normalizedItems = normalizeLineItems(line_items);
  const taxRate = normalizeTaxRate(tax_rate ?? 0);
  if (normalizedItems.error || taxRate === null) {
    return res.status(400).json({ error: normalizedItems.error || 'Tax rate must be between 0 and 100' });
  }

  try {
    const { subtotal, tax, total } = calculateTotals(normalizedItems.items, taxRate);
    const token = crypto.randomBytes(16).toString('hex');
    const row = await pool.query(
      `INSERT INTO business_quotes (business_id, client_name, client_email, title, line_items, subtotal_cents, tax_rate, total_cents, valid_until, token)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [businessId, client_name, client_email, title, JSON.stringify(normalizedItems.items), subtotal, taxRate, total, valid_until, token]
    );
    res.status(201).json(row.rows[0]);
  } catch (err) { next(err); }
};

exports.updateQuote = async (req, res, next) => {
  const { businessId, id: quoteId } = req.params;
  const { client_name, client_email, title, line_items, tax_rate, valid_until, status } = req.body;
  try {
    const existingResult = await pool.query(
      'SELECT * FROM business_quotes WHERE id=$1 AND business_id=$2',
      [quoteId, businessId]
    );
    const existing = existingResult.rows[0];
    if (!existing) return res.status(404).json({ error: 'Not found' });

    const nextItemsResult = normalizeLineItems(line_items === undefined ? existing.line_items : line_items);
    const nextTaxRate = normalizeTaxRate(tax_rate === undefined ? existing.tax_rate : tax_rate);
    if (nextItemsResult.error || nextTaxRate === null) {
      return res.status(400).json({ error: nextItemsResult.error || 'Tax rate must be between 0 and 100' });
    }
    if (status !== undefined && !VALID_STATUSES.has(status)) {
      return res.status(400).json({ error: 'Invalid quote status' });
    }

    const nextItems = nextItemsResult.items;
    const { subtotal, tax, total } = calculateTotals(nextItems, nextTaxRate);
    const row = await pool.query(
      `UPDATE business_quotes SET client_name=$1, client_email=$2, title=$3, line_items=$4,
       subtotal_cents=$5, tax_rate=$6, total_cents=$7, valid_until=$8, status=COALESCE($9,status), updated_at=NOW()
       WHERE id=$10 AND business_id=$11 RETURNING *`,
      [client_name === undefined ? existing.client_name : client_name,
        client_email === undefined ? existing.client_email : client_email,
        title === undefined ? existing.title : title,
        JSON.stringify(nextItems), subtotal, nextTaxRate,
        total, valid_until === undefined ? existing.valid_until : valid_until,
        status, quoteId, businessId]
    );
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
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const quoteRow = await client.query(
      'SELECT * FROM business_quotes WHERE id=$1 AND business_id=$2 FOR UPDATE',
      [quoteId, businessId]
    );
    if (!quoteRow.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Quote not found' });
    }
    const quote = quoteRow.rows[0];
    if (!['approved', 'sent'].includes(quote.status)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Only approved or sent quotes can be converted to invoices' });
    }

    const businessRow = await client.query(
      `UPDATE businesses SET invoice_seq = invoice_seq + 1
       WHERE id = $1 RETURNING invoice_seq, user_id`,
      [businessId]
    );
    if (!businessRow.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Business not found' });
    }

    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + 30);
    const invoiceNumber = `INV-${new Date().getFullYear()}-${String(businessRow.rows[0].invoice_seq).padStart(4, '0')}`;
    const lineItems = (Array.isArray(quote.line_items) ? quote.line_items : []).map((item) => {
      const quantity = Number(item.quantity) || 1;
      const unitPrice = item.unit_price !== undefined
        ? Number(item.unit_price)
        : Number(item.unit_price_cents || 0) / 100;
      return {
        description: String(item.description || quote.title || 'Quoted service').trim(),
        quantity,
        unit_price: unitPrice,
        amount: Math.round(quantity * unitPrice * 100) / 100,
      };
    });
    const subtotal = Number(quote.subtotal_cents || 0) / 100;
    const total = Number(quote.total_cents || 0) / 100;
    const taxAmount = Math.round((total - subtotal) * 100) / 100;
    const publicToken = crypto.randomUUID();
    const invoiceRow = await client.query(
      `INSERT INTO business_invoices
         (user_id, business_id, invoice_number, client_name, client_email,
          status, due_date, subtotal, invoice_tax_rate, tax_amount, total,
          line_items, notes, public_token)
       VALUES ($1,$2,$3,$4,$5,'draft',$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
      [
        businessRow.rows[0].user_id, businessId, invoiceNumber,
        quote.client_name, quote.client_email, dueDate, subtotal,
        quote.tax_rate || 0, taxAmount, total, JSON.stringify(lineItems),
        `Generated from quote ${quoteId}${quote.title ? `: ${quote.title}` : ''}`, publicToken,
      ]
    );
    await client.query(
      "UPDATE business_quotes SET status='converted', invoice_id=$2, updated_at=NOW() WHERE id=$1",
      [quoteId, invoiceRow.rows[0].id]
    );
    await client.query('COMMIT');
    res.status(201).json(invoiceRow.rows[0]);
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch { /* preserve the original database error */ }
    next(err);
  } finally {
    client.release();
  }
};
