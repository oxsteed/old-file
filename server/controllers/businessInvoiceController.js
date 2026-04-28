// server/controllers/businessInvoiceController.js
// Invoice management for the Business Hub.
// Invoices track off-platform (and on-platform) billing so that all revenue
// flows into the Life Pulse regardless of how money was earned.

const { randomUUID } = require('crypto');
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
    const public_token = randomUUID();

    const { rows: [inv] } = await client.query(`
      INSERT INTO business_invoices
        (user_id, business_id, invoice_number, client_name, client_email, client_company,
         status, due_date, subtotal, invoice_tax_rate, tax_amount, total, line_items, notes, job_id, public_token)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
      RETURNING *
    `, [
      access.owner_id, access.id, invoice_number,
      client_name.trim(), client_email || null, client_company || null,
      status, due_date || null,
      subtotal, parseFloat(invoice_tax_rate), tax_amount, total,
      JSON.stringify(line_items), notes || null, job_id || null,
      public_token,
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

    // Verify invoice exists and is in a deletable state (draft or cancelled only)
    const inv = await pool.query(
      'SELECT id, status FROM business_invoices WHERE id = $1 AND business_id = $2 AND user_id = $3',
      [req.params.invoiceId, access.id, access.owner_id]
    );
    if (!inv.rows[0]) return res.status(404).json({ error: 'Invoice not found' });

    if (!['draft', 'cancelled'].includes(inv.rows[0].status)) {
      return res.status(400).json({ error: `Cannot delete invoice in '${inv.rows[0].status}' status. Only draft and cancelled invoices can be deleted.` });
    }

    // Soft-delete or hard-delete (status check is sufficient authorization)
    const result = await pool.query(
      'DELETE FROM business_invoices WHERE id = $1 AND business_id = $2 AND user_id = $3 RETURNING id',
      [req.params.invoiceId, access.id, access.owner_id]
    );
    if (!result.rows.length) return res.status(500).json({ error: 'Delete failed unexpectedly' });
    return res.json({ ok: true });
  } catch (err) {
    logger.error('deleteInvoice error', { userId: req.user?.id, businessId: req.params?.id, invoiceId: req.params?.invoiceId, err: err.message });
    return res.status(500).json({ error: 'Failed to delete invoice' });
  }
}

// ── Get invoice by public token (no auth required) ────────────────────────────
// GET /api/invoices/public/:token
async function getPublicInvoice(req, res) {
  try {
    const { token } = req.params;
    const { rows: [inv] } = await pool.query(
      'SELECT * FROM business_invoices WHERE public_token = $1',
      [token]
    );

    if (!inv) return res.status(404).json({ error: 'Invoice not found' });

    let business = null;
    if (inv.business_id) {
      // Business-scoped invoice
      const { rows: [biz] } = await pool.query(
        'SELECT id, business_name, logo_url, website, phone FROM businesses WHERE id = $1',
        [inv.business_id]
      );
      business = biz;
    } else {
      // Helper-scoped invoice - fetch helper name
      const { rows: [user] } = await pool.query(
        'SELECT id, first_name, last_name FROM users WHERE id = $1',
        [inv.user_id]
      );
      if (user) {
        business = {
          id: null,
          business_name: `${user.first_name} ${user.last_name}`,
          logo_url: null,
          website: null,
          phone: null,
        };
      } else {
        // Helper deleted but invoice still exists
        business = {
          id: null,
          business_name: 'Invoice from deleted account',
          logo_url: null,
          website: null,
          phone: null,
        };
      }
    }

    return res.json({ invoice: inv, business: business || {} });
  } catch (err) {
    logger.error('getPublicInvoice error', { err: err.message });
    return res.status(500).json({ error: 'Failed to load invoice' });
  }
}

// ── Send invoice (dual-track: internal notifications + external public link) ──
// POST /api/businesses/:id/invoices/:invoiceId/send
async function sendInvoice(req, res) {
  const client = await pool.connect();
  try {
    const access = await canManageBusinessFinance(req.user.id, req.params.id);
    if (!access) return res.status(404).json({ error: 'Business not found' });

    await client.query('BEGIN');

    // Fetch the invoice
    const { rows: [inv] } = await client.query(
      'SELECT * FROM business_invoices WHERE id = $1 AND business_id = $2',
      [req.params.invoiceId, access.id]
    );
    if (!inv) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Invoice not found' });
    }

    // Update invoice status to 'sent' and set sent_at
    const { rows: [updatedInv] } = await client.query(`
      UPDATE business_invoices SET
        status = 'sent',
        sent_at = NOW(),
        updated_at = NOW()
      WHERE id = $1
      RETURNING *
    `, [inv.id]);

    // Check if a user exists with the client_email
    let isInternalUser = false;
    if (inv.client_email) {
      const { rows: [user] } = await client.query(
        'SELECT id FROM users WHERE email = $1 AND is_active = TRUE',
        [inv.client_email.toLowerCase()]
      );

      if (user) {
        isInternalUser = true;
        // Create a notification for the user
        const notificationText = `${access.business_name} has sent you an invoice for ${updatedInv.total}`;
        await client.query(`
          INSERT INTO notifications
            (user_id, title, body, type, data, created_at)
          VALUES ($1, $2, $3, $4, $5, NOW())
        `, [
          user.id,
          `Invoice from ${access.business_name}`,
          notificationText,
          'invoice',
          JSON.stringify({ invoiceId: inv.id, businessId: access.id }),
        ]);

        logger.info('Invoice sent to internal user', {
          invoiceId: inv.id,
          recipientUserId: user.id,
          businessId: access.id,
        });
      }
    }

    await client.query('COMMIT');

    return res.json({
      invoice: updatedInv,
      isInternalUser,
      publicToken: updatedInv.public_token,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error('sendInvoice error', { err: err.message });
    return res.status(500).json({ error: 'Failed to send invoice' });
  } finally {
    client.release();
  }
}

// ── Helper-scoped invoices (for helpers without a business) ─────────────────
// GET /api/helpers/invoices
async function listHelperInvoices(req, res) {
  try {
    const userId = req.user.id;
    const { status, limit = 50, offset = 0 } = req.query;
    const safeLim = Math.min(parseInt(limit) || 50, 100);
    const safeOff = Math.max(parseInt(offset) || 0, 0);

    const params = [userId, safeLim, safeOff];
    const statusClause = status ? `AND status = $4` : '';
    if (status) params.push(status);

    const { rows } = await pool.query(`
      SELECT id, invoice_number, client_name, client_email, client_company,
             status, issue_date, due_date, subtotal, total, amount_paid,
             invoice_tax_rate, notes, job_id, sent_at, paid_at, created_at
      FROM business_invoices
      WHERE user_id = $1 AND business_id IS NULL
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
      FROM business_invoices WHERE user_id = $1 AND business_id IS NULL
    `, [userId]);

    return res.json({ invoices: rows, summary });
  } catch (err) {
    logger.error('listHelperInvoices error', { err: err.message });
    return res.status(500).json({ error: 'Failed to load invoices' });
  }
}

// ── Create helper invoice ──────────────────────────────────────────────────────
async function createHelperInvoice(req, res) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const userId = req.user.id;
    const {
      client_name, client_email, client_company,
      due_date, line_items = [], invoice_tax_rate = 0,
      notes, job_id, status = 'draft',
    } = req.body;

    if (!client_name?.trim()) return res.status(400).json({ error: 'Client name is required' });
    if (!Array.isArray(line_items) || line_items.length === 0) {
      return res.status(400).json({ error: 'At least one line item is required' });
    }

    const invoice_number = await nextHelperInvoiceNumber(client);
    const { subtotal, tax_amount, total } = computeTotals(line_items, invoice_tax_rate);
    const public_token = randomUUID();

    const { rows: [inv] } = await client.query(`
      INSERT INTO business_invoices
        (user_id, business_id, invoice_number, client_name, client_email, client_company,
         status, due_date, subtotal, invoice_tax_rate, tax_amount, total, line_items, notes, job_id, public_token)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
      RETURNING *
    `, [
      userId, null, invoice_number,
      client_name.trim(), client_email || null, client_company || null,
      status, due_date || null,
      subtotal, parseFloat(invoice_tax_rate), tax_amount, total,
      JSON.stringify(line_items), notes || null, job_id || null,
      public_token,
    ]);

    await client.query('COMMIT');
    return res.status(201).json({ invoice: inv });
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error('createHelperInvoice error', { err: err.message });
    return res.status(500).json({ error: 'Failed to create invoice' });
  } finally {
    client.release();
  }
}

// ── Update helper invoice ──────────────────────────────────────────────────────
async function updateHelperInvoice(req, res) {
  try {
    const userId = req.user.id;
    const invoiceId = req.params.invoiceId;
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
      WHERE id = $12 AND user_id = $13 AND business_id IS NULL
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
      invoiceId, userId,
    ]);

    if (!inv) return res.status(404).json({ error: 'Invoice not found' });
    return res.json({ invoice: inv });
  } catch (err) {
    logger.error('updateHelperInvoice error', { err: err.message });
    return res.status(500).json({ error: 'Failed to update invoice' });
  }
}

// ── Mark helper invoice paid ───────────────────────────────────────────────────
async function markHelperInvoicePaid(req, res) {
  try {
    const userId = req.user.id;
    const invoiceId = req.params.invoiceId;
    const { amount } = req.body;
    const paidAmt = amount != null ? parseFloat(amount) : null;

    // Fetch current invoice
    const { rows: [existing] } = await pool.query(
      'SELECT * FROM business_invoices WHERE id = $1 AND user_id = $2 AND business_id IS NULL',
      [invoiceId, userId]
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
      WHERE id = $3 AND user_id = $4 AND business_id IS NULL
      RETURNING *
    `, [newPaidTotal, newStatus, invoiceId, userId]);

    return res.json({ invoice: inv });
  } catch (err) {
    logger.error('markHelperInvoicePaid error', { err: err.message });
    return res.status(500).json({ error: 'Failed to mark invoice paid' });
  }
}

// ── Delete helper invoice ──────────────────────────────────────────────────────
async function deleteHelperInvoice(req, res) {
  try {
    const userId = req.user.id;
    const invoiceId = req.params.invoiceId;

    // Verify invoice exists and is in a deletable state
    const inv = await pool.query(
      'SELECT id, status FROM business_invoices WHERE id = $1 AND user_id = $2 AND business_id IS NULL',
      [invoiceId, userId]
    );
    if (!inv.rows[0]) return res.status(404).json({ error: 'Invoice not found' });

    if (!['draft', 'cancelled'].includes(inv.rows[0].status)) {
      return res.status(400).json({ error: `Cannot delete invoice in '${inv.rows[0].status}' status. Only draft and cancelled invoices can be deleted.` });
    }

    const result = await pool.query(
      'DELETE FROM business_invoices WHERE id = $1 AND user_id = $2 AND business_id IS NULL RETURNING id',
      [invoiceId, userId]
    );
    if (!result.rows.length) return res.status(500).json({ error: 'Delete failed unexpectedly' });
    return res.json({ ok: true });
  } catch (err) {
    logger.error('deleteHelperInvoice error', { userId: req.user?.id, invoiceId: req.params?.invoiceId, err: err.message });
    return res.status(500).json({ error: 'Failed to delete invoice' });
  }
}

// ── Send helper invoice (dual-track: internal + external) ───────────────────────
async function sendHelperInvoice(req, res) {
  const client = await pool.connect();
  try {
    const userId = req.user.id;
    const invoiceId = req.params.invoiceId;

    // Fetch the invoice
    const { rows: [inv] } = await client.query(
      'SELECT * FROM business_invoices WHERE id = $1 AND user_id = $2 AND business_id IS NULL',
      [invoiceId, userId]
    );
    if (!inv) return res.status(404).json({ error: 'Invoice not found' });

    await client.query('BEGIN');

    // Update invoice status to 'sent' and set sent_at
    const { rows: [updatedInv] } = await client.query(`
      UPDATE business_invoices SET
        status = 'sent',
        sent_at = NOW(),
        updated_at = NOW()
      WHERE id = $1
      RETURNING *
    `, [inv.id]);

    // Check if a user exists with the client_email
    let isInternalUser = false;
    if (inv.client_email) {
      const { rows: [user] } = await client.query(
        'SELECT id FROM users WHERE email = $1 AND is_active = TRUE',
        [inv.client_email.toLowerCase()]
      );

      if (user) {
        isInternalUser = true;
        // Fetch helper name
        const { rows: [helper] } = await client.query(
          'SELECT first_name, last_name FROM users WHERE id = $1',
          [userId]
        );

        if (!helper) {
          logger.warn('Helper user not found when sending invoice', { userId, invoiceId });
          isInternalUser = false;
        } else {
          const helperName = `${helper.first_name} ${helper.last_name}`;

          // Create a notification for the user
          const notificationText = `${helperName} has sent you an invoice for ${updatedInv.total}`;
          await client.query(`
            INSERT INTO notifications
              (user_id, title, body, type, data, created_at)
            VALUES ($1, $2, $3, $4, $5, NOW())
          `, [
            user.id,
            `Invoice from ${helperName}`,
            notificationText,
            'invoice',
            JSON.stringify({ invoiceId: inv.id }),
          ]);
        }

        logger.info('Helper invoice sent to internal user', {
          invoiceId: inv.id,
          recipientUserId: user.id,
          senderId: userId,
        });
      }
    }

    await client.query('COMMIT');

    return res.json({
      invoice: updatedInv,
      isInternalUser,
      publicToken: updatedInv.public_token,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error('sendHelperInvoice error', { err: err.message });
    return res.status(500).json({ error: 'Failed to send invoice' });
  } finally {
    client.release();
  }
}

// ── Helper invoice number generator (global, not per-business) ─────────────────
async function nextHelperInvoiceNumber(client) {
  // For helper invoices, use a simpler format: INV-YYYY-####
  const year = new Date().getFullYear();
  // Get max invoice number from all helper invoices this year
  const { rows: [result] } = await client.query(`
    SELECT COALESCE(MAX(CAST(SUBSTRING(invoice_number FROM 9) AS INT)), 0) AS max_seq
    FROM business_invoices
    WHERE business_id IS NULL AND invoice_number LIKE $1
  `, [`INV-${year}-%`]);

  const nextSeq = (result?.max_seq || 0) + 1;
  const seq = String(nextSeq).padStart(4, '0');
  return `INV-${year}-${seq}`;
}

module.exports = {
  listInvoices, getInvoice, getPublicInvoice, createInvoice,
  updateInvoice, markInvoicePaid, deleteInvoice, sendInvoice,
  listHelperInvoices, createHelperInvoice, updateHelperInvoice,
  markHelperInvoicePaid, deleteHelperInvoice, sendHelperInvoice,
};
