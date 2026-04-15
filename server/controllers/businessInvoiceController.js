// server/controllers/businessInvoiceController.js
// Invoice management for the Business Hub.
// Invoices track off-platform (and on-platform) billing so that all revenue
// flows into the Life Pulse regardless of how money was earned.

const pool   = require('../db');
const logger = require('../utils/logger');
const { canManageBusinessFinance } = require('../utils/businessOwnership');

function round2(n) { return Math.round((n || 0) * 100) / 100; }

// ── Compute totals from line items + tax rate ─────────────────────────────────
function computeTotals(lineItems, invoiceTaxRate) {
  const subtotal = lineItems.reduce((sum, li) => {
    const qty   = parseFloat(li.quantity  || 1);
    const price = parseFloat(li.unit_price || 0);
    return sum + qty * price;
  }, 0);
  const rate      = parseFloat(invoiceTaxRate || 0) / 100;
  const taxAmount = round2(subtotal * rate);
  const total     = round2(subtotal + taxAmount);
  return { subtotal: round2(subtotal), tax_amount: taxAmount, total };
}

// ── Generate human-readable invoice number ─────────────────────────────────────
// Format: BIZ-YYYY-NNNN where NNNN auto-increments per business
async function nextInvoiceNumber(client, bizId) {
  const { rows: [biz] } = await client.query(
    'UPDATE businesses SET invoice_seq = invoice_seq + 1 WHERE id = $1 RETURNING invoice_seq',
    [bizId]
  );
  const year = new Date().getFullYear();
  const seq  = String(biz.invoice_seq).padStart(4, '0');
  return `INV-${year}-${seq}`;
}

// ── List invoices for a business ──────────────────────────────────────────────
// GET /api/businesses/:id/invoices?status=sent&limit=50&offset=0
async function listInvoices(req, res) {
  try {
    const access = await canManageBusinessFinance(req.user.id, req.params.id);
    if (!access) return res.status(404).json({ error: 'Business not found' });

    const { status, limit = 50, offset = 0 } = req.query;
    const safeLim = Math.min(parseInt(limit) || 50, 100);
    const safeOff = Math.max(parseInt(offset) || 0, 0);

    const params = [access.id, safeLim, safeOff];
    const statusClause = status ? `AND status = $4` : '';
    if (status) params.push(status);

    const { rows } = await pool.query(`
      SELECT id, invoice_number, client_name, client_email, client_company,
             status, issue_date, due_date, subtotal, total, amount_paid,
             invoice_tax_rate, notes, job_id, sent_at, paid_at, created_at
      FROM business_invoices
      WHERE business_id = $1
        ${statusClause}
      ORDER BY created_at DESC
      LIMIT $2 OFFSET $3
    `, params);

    // Summary counts
    const { rows: [summary] } = await pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE status = 'draft')   AS draft,
        COUNT(*) FILTER (WHERE status = 'sent')    AS sent,
        COUNT(*) FILTER (WHERE status = 'paid')    AS paid,
        COUNT(*) FILTER (WHERE status = 'overdue') AS overdue,
        COALESCE(SUM(total - amount_paid) FILTER (WHERE status IN ('sent','overdue')), 0) AS outstanding_total
      FROM business_invoices WHERE business_id = $1
    `, [access.id]);

    return res.json({ invoices: rows, summary });
  } catch (err) {
    logger.error('listInvoices error', { err: err.message });
    return res.status(500).json({ error: 'Failed to load invoices' });
  }
}

// ── Get single invoice (with full line items) ─────────────────────────────────
async function getInvoice(req, res) {
  try {
    const access = await canManageBusinessFinance(req.user.id, req.params.id);
    if (!access) return res.status(404).json({ error: 'Business not found' });

    const { rows: [inv] } = await pool.query(
      'SELECT * FROM business_invoices WHERE id = $1 AND business_id = $2',
      [req.params.invoiceId, access.id]
    );
    if (!inv) return res.status(404).json({ error: 'Invoice not found' });
    return res.json({ invoice: inv });
  } catch (err) {
    logger.error('getInvoice error', { err: err.message });
    return res.status(500).json({ error: 'Failed to load invoice' });
  }
}

// ── Create invoice ─────────────────────────────────────────────────────────────
async function createInvoice(req, res) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const access = await canManageBusinessFinance(req.user.id, req.params.id);
    if (!access) return res.status(404).json({ error: 'Business not found' });

    const {
      client_name, client_email, client_company,
      due_date, line_items = [], invoice_tax_rate = 0,
      notes, job_id, status = 'draft',
    } = req.body;

    if (!client_name?.trim()) return res.status(400).json({ error: 'Client name is required' });
    if (!Array.isArray(line_items) || line_items.length === 0) {
      return res.status(400).json({ error: 'At least one line item is required' });
    }

    const invoice_number = await nextInvoiceNumber(client, access.id);
    const { subtotal, tax_amount, total } = computeTotals(line_items, invoice_tax_rate);

    const { rows: [inv] } = await client.query(`
      INSERT INTO business_invoices
        (user_id, business_id, invoice_number, client_name, client_email, client_company,
         status, due_date, subtotal, invoice_tax_rate, tax_amount, total, line_items, notes, job_id)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
      RETURNING *
    `, [
      access.owner_id, access.id, invoice_number,
      client_name.trim(), client_email || null, client_company || null,
      status, due_date || null,
      subtotal, parseFloat(invoice_tax_rate), tax_amount, total,
      JSON.stringify(line_items), notes || null, job_id || null,
    ]);

    await client.query('COMMIT');
    return res.status(201).json({ invoice: inv });
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error('createInvoice error', { err: err.message });
    return res.status(500).json({ error: 'Failed to create invoice' });
  } finally {
    client.release();
  }
}

// ── Update invoice ─────────────────────────────────────────────────────────────
async function updateInvoice(req, res) {
  try {
    const access = await canManageBusinessFinance(req.user.id, req.params.id);
    if (!access) return res.status(404).json({ error: 'Business not found' });

    const {
      client_name, client_email, client_company,
      due_date, line_items, invoice_tax_rate, notes, status,
    } = req.body;

    // Recalculate totals if line items provided
    let subtotal, tax_amount, total;
    if (line_items) {
      ({ subtotal, tax_amount, total } = computeTotals(line_items, invoice_tax_rate));
    }

    const { rows: [inv] } = await pool.query(`
      UPDATE business_invoices SET
        client_name      = COALESCE($1, client_name),
        client_email     = COALESCE($2, client_email),
        client_company   = COALESCE($3, client_company),
        due_date         = COALESCE($4, due_date),
        line_items       = COALESCE($5, line_items),
        invoice_tax_rate = COALESCE($6, invoice_tax_rate),
        subtotal         = COALESCE($7, subtotal),
        tax_amount       = COALESCE($8, tax_amount),
        total            = COALESCE($9, total),
        notes            = COALESCE($10, notes),
        status           = COALESCE($11, status),
        sent_at          = CASE WHEN $11 = 'sent' AND sent_at IS NULL THEN NOW() ELSE sent_at END,
        updated_at       = NOW()
      WHERE id = $12 AND business_id = $13 AND user_id = $14
      RETURNING *
    `, [
      client_name || null, client_email || null, client_company || null,
      due_date || null,
      line_items ? JSON.stringify(line_items) : null,
      invoice_tax_rate != null ? parseFloat(invoice_tax_rate) : null,
      subtotal != null ? subtotal : null,
      tax_amount != null ? tax_amount : null,
      total != null ? total : null,
      notes || null, status || null,
      req.params.invoiceId, access.id, access.owner_id,
    ]);

    if (!inv) return res.status(404).json({ error: 'Invoice not found' });
    return res.json({ invoice: inv });
  } catch (err) {
    logger.error('updateInvoice error', { err: err.message });
    return res.status(500).json({ error: 'Failed to update invoice' });
  }
}

// ── Mark invoice paid (full or partial) ───────────────────────────────────────
// POST /api/businesses/:id/invoices/:invoiceId/pay
async function markInvoicePaid(req, res) {
  try {
    const access = await canManageBusinessFinance(req.user.id, req.params.id);
    if (!access) return res.status(404).json({ error: 'Business not found' });

    const { amount } = req.body;
    const paidAmt = amount != null ? parseFloat(amount) : null;

    // Fetch current invoice
    const { rows: [existing] } = await pool.query(
      'SELECT * FROM business_invoices WHERE id = $1 AND business_id = $2',
      [req.params.invoiceId, access.id]
    );
    if (!existing) return res.status(404).json({ error: 'Invoice not found' });

    const newPaidTotal = paidAmt != null
      ? round2(paidAmt)
      : parseFloat(existing.total);

    const isFullyPaid = newPaidTotal >= parseFloat(existing.total) - 0.01;
    const newStatus   = isFullyPaid ? 'paid' : 'partial';

    const { rows: [inv] } = await pool.query(`
      UPDATE business_invoices SET
        amount_paid = $1,
        status      = $2,
        paid_at     = CASE WHEN $2 = 'paid' AND paid_at IS NULL THEN NOW() ELSE paid_at END,
        updated_at  = NOW()
      WHERE id = $3 AND business_id = $4 AND user_id = $5
      RETURNING *
    `, [newPaidTotal, newStatus, req.params.invoiceId, access.id, access.owner_id]);

    return res.json({ invoice: inv });
  } catch (err) {
    logger.error('markInvoicePaid error', { err: err.message });
    return res.status(500).json({ error: 'Failed to mark invoice paid' });
  }
}

// ── Delete invoice ─────────────────────────────────────────────────────────────
async function deleteInvoice(req, res) {
  try {
    const access = await canManageBusinessFinance(req.user.id, req.params.id);
    if (!access) return res.status(404).json({ error: 'Business not found' });

    const { rowCount } = await pool.query(
      'DELETE FROM business_invoices WHERE id = $1 AND business_id = $2 AND user_id = $3',
      [req.params.invoiceId, access.id, access.owner_id]
    );
    if (!rowCount) return res.status(404).json({ error: 'Invoice not found' });
    return res.json({ ok: true });
  } catch (err) {
    logger.error('deleteInvoice error', { err: err.message });
    return res.status(500).json({ error: 'Failed to delete invoice' });
  }
}

module.exports = {
  listInvoices, getInvoice, createInvoice,
  updateInvoice, markInvoicePaid, deleteInvoice,
};
