const express = require('express');
const router = express.Router();
const pool = require('../db');
const { authenticate } = require('../middleware/auth');
const { requireSuperAdmin } = require('../middleware/adminAuth');
const { generalLimiter } = require('../middleware/rateLimiter');
const logger = require('../utils/logger');
const { logAdminAction } = require('../services/auditService');
const { sendBusinessInvoiceEmail } = require('../utils/businessInvoiceEmail');

const ISSUED_SELECT = `
  SELECT bi.id, bi.invoice_number, bi.client_name, bi.client_email,
         bi.status,
         bi.issue_date AS issued_at,
         bi.due_date   AS due_at,
         ROUND(bi.total * 100)::bigint AS amount_cents,
         bi.total, bi.amount_paid, bi.sent_at, bi.paid_at, bi.created_at,
         bi.public_token,
         b.business_name,
         'issued' AS perspective
  FROM business_invoices bi
  LEFT JOIN businesses b ON b.id = bi.business_id
  WHERE bi.user_id = $1`;

const RECEIVED_SELECT = `
  SELECT bi.id, bi.invoice_number, bi.client_name, bi.client_email,
         bi.status,
         bi.issue_date AS issued_at,
         bi.due_date   AS due_at,
         ROUND(bi.total * 100)::bigint AS amount_cents,
         bi.total, bi.amount_paid, bi.sent_at, bi.paid_at, bi.created_at,
         bi.public_token,
         COALESCE(b.business_name, TRIM(CONCAT(u.first_name, ' ', u.last_name))) AS business_name,
         'received' AS perspective
  FROM business_invoices bi
  LEFT JOIN businesses b ON b.id = bi.business_id
  LEFT JOIN users u ON u.id = bi.user_id AND bi.business_id IS NULL
  WHERE LOWER(TRIM(bi.client_email)) = LOWER(TRIM($2))
    AND bi.user_id <> $1
    AND bi.status IN ('sent', 'partial', 'overdue', 'paid')`;

async function getInvoiceForUser(invoiceId, userId, userEmail, role) {
  const isAdmin = ['admin', 'super_admin'].includes(role);
  const { rows } = await pool.query(
    `SELECT bi.*,
            u.preferred_language,
            b.business_name,
            ROUND(bi.total * 100)::bigint AS amount_cents,
            CASE
              WHEN bi.user_id = $3 THEN 'issued'
              WHEN LOWER(TRIM(bi.client_email)) = LOWER(TRIM($4)) THEN 'received'
              ELSE 'admin'
            END AS perspective
     FROM business_invoices bi
     LEFT JOIN businesses b ON b.id = bi.business_id
     LEFT JOIN users u ON u.id = bi.user_id
     WHERE bi.id = $1
       AND (
         $2
         OR bi.user_id = $3
         OR LOWER(TRIM(bi.client_email)) = LOWER(TRIM($4))
       )`,
    [invoiceId, isAdmin, userId, userEmail || '']
  );
  return rows[0] || null;
}

// GET /api/invoices?view=issued|received|all
router.get('/', authenticate, generalLimiter, async (req, res) => {
  try {
    const limit  = Math.min(parseInt(req.query.limit, 10)  || 20, 100);
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
    const status = req.query.status ? String(req.query.status) : null;
    const view = String(req.query.view || 'all').toLowerCase();
    const userEmail = req.user.email || '';

    let rows;
    let total;

    if (view === 'issued') {
      const params = [req.user.id];
      const statusClause = status ? ` AND bi.status = $${params.push(status)}` : '';
      const listParams = [...params, limit, offset];
      const { rows: issuedRows } = await pool.query(
        `${ISSUED_SELECT}${statusClause} ORDER BY bi.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        listParams
      );
      const { rows: [countRow] } = await pool.query(
        `SELECT COUNT(*)::int AS total FROM business_invoices bi WHERE bi.user_id = $1${statusClause}`,
        params
      );
      rows = issuedRows;
      total = countRow?.total ?? 0;
    } else if (view === 'received') {
      const params = [req.user.id, userEmail];
      const statusClause = status ? ` AND bi.status = $${params.push(status)}` : '';
      const listParams = [...params, limit, offset];
      const { rows: receivedRows } = await pool.query(
        `${RECEIVED_SELECT}${statusClause} ORDER BY bi.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        listParams
      );
      const { rows: [countRow] } = await pool.query(
        `SELECT COUNT(*)::int AS total FROM business_invoices bi
          WHERE LOWER(TRIM(bi.client_email)) = LOWER(TRIM($2))
            AND bi.user_id <> $1
            AND bi.status IN ('sent', 'partial', 'overdue', 'paid')${statusClause}`,
        params
      );
      rows = receivedRows;
      total = countRow?.total ?? 0;
    } else {
      const params = [req.user.id, userEmail];
      const statusFilter = status ? `WHERE combined.status = $${params.push(status)}` : '';
      const listParams = [...params, limit, offset];
      const { rows: allRows } = await pool.query(
        `SELECT * FROM (
          ${ISSUED_SELECT}
          UNION ALL
          ${RECEIVED_SELECT}
        ) combined
        ${statusFilter}
        ORDER BY combined.created_at DESC
        LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        listParams
      );
      const { rows: [countRow] } = await pool.query(
        `SELECT COUNT(*)::int AS total FROM (
          SELECT bi.status FROM business_invoices bi WHERE bi.user_id = $1
          UNION ALL
          SELECT bi.status FROM business_invoices bi
            WHERE LOWER(TRIM(bi.client_email)) = LOWER(TRIM($2))
              AND bi.user_id <> $1
              AND bi.status IN ('sent', 'partial', 'overdue', 'paid')
        ) combined ${statusFilter}`,
        params
      );
      rows = allRows;
      total = countRow?.total ?? 0;
    }

    res.json({
      success: true,
      invoices: rows,
      total,
      limit,
      offset,
      view,
    });
  } catch (err) {
    logger.error('GET /api/invoices error', { err: err.message });
    res.status(500).json({ error: 'Failed to fetch invoices' });
  }
});

router.get('/:id', authenticate, generalLimiter, async (req, res) => {
  try {
    const inv = await getInvoiceForUser(
      req.params.id,
      req.user.id,
      req.user.email,
      req.user.role
    );
    if (!inv) return res.status(404).json({ error: 'Invoice not found' });
    res.json({ success: true, invoice: inv });
  } catch (err) {
    logger.error('GET /api/invoices/:id error', { err: err.message });
    res.status(500).json({ error: 'Failed to fetch invoice' });
  }
});

router.patch('/:id/mark-paid', authenticate, requireSuperAdmin, async (req, res) => {
  try {
    const { rows: [inv] } = await pool.query(
      `UPDATE business_invoices
       SET status = 'paid', paid_at = NOW(), amount_paid = total
       WHERE id = $1 RETURNING *`,
      [req.params.id]
    );
    if (!inv) return res.status(404).json({ error: 'Invoice not found' });
    try {
      await logAdminAction({
        adminId: req.user.id,
        action: 'invoice_marked_paid',
        targetType: 'business_invoice',
        targetId: inv.id,
        description: `Invoice ${inv.invoice_number || inv.id} marked as paid`,
        before: { status: 'unpaid' },
        after: { status: 'paid', amount_paid: inv.amount_paid },
        req,
      });
    } catch (_) {}
    res.json({ success: true, invoice: inv });
  } catch (err) {
    logger.error('PATCH /api/invoices/:id/mark-paid error', { err: err.message });
    res.status(500).json({ error: 'Failed to update invoice' });
  }
});

router.patch('/:id/status', authenticate, requireSuperAdmin, async (req, res) => {
  try {
    const { status } = req.body;
    const valid = ['draft', 'sent', 'paid', 'overdue', 'cancelled', 'partial'];
    if (!status || !valid.includes(status)) {
      return res.status(400).json({ error: 'Valid status required', valid });
    }
    const { rows: [before] } = await pool.query(
      'SELECT id, status FROM business_invoices WHERE id = $1',
      [req.params.id]
    );
    if (!before) return res.status(404).json({ error: 'Invoice not found' });
    const { rows: [inv] } = await pool.query(
      `UPDATE business_invoices
          SET status = $1,
              paid_at = CASE
                WHEN $1 = 'paid' THEN COALESCE(paid_at, NOW())
                WHEN $1 IN ('sent', 'partial', 'overdue', 'draft') THEN NULL
                ELSE paid_at
              END,
              amount_paid = CASE
                WHEN $1 = 'paid' THEN total
                WHEN $1 IN ('sent', 'overdue', 'draft') AND status = 'paid' THEN 0
                ELSE amount_paid
              END
        WHERE id = $2
        RETURNING *`,
      [status, req.params.id]
    );
    try {
      await logAdminAction({
        adminId: req.user.id,
        action: 'invoice_status_changed',
        targetType: 'business_invoice',
        targetId: inv.id,
        before: { status: before.status },
        after: { status },
        req,
      });
    } catch (_) {}
    res.json({ success: true, invoice: inv });
  } catch (err) {
    logger.error('PATCH /api/invoices/:id/status error', { err: err.message });
    res.status(500).json({ error: 'Failed to update invoice' });
  }
});

router.post('/:id/resend-email', authenticate, generalLimiter, async (req, res) => {
  try {
    const inv = await getInvoiceForUser(
      req.params.id,
      req.user.id,
      req.user.email,
      req.user.role
    );
    if (!inv) return res.status(404).json({ error: 'Invoice not found' });
    if (inv.perspective === 'received' && !['admin', 'super_admin'].includes(req.user.role)) {
      return res.status(403).json({ error: 'Only the invoice issuer can resend email' });
    }

    if (!inv.client_email) {
      return res.status(400).json({ error: 'Invoice has no client email address' });
    }
    if (!inv.public_token) {
      return res.status(409).json({ error: 'Invoice is missing a public link token' });
    }

    const emailResult = await sendBusinessInvoiceEmail({
      invoice: inv,
      recipientEmail: inv.client_email,
      issuerName: inv.business_name || 'OxSteed',
      language: inv.preferred_language || 'en',
    });
    if (!emailResult.success) {
      return res.status(502).json({ error: 'Failed to deliver invoice email' });
    }

    await pool.query(
      "UPDATE business_invoices SET sent_at = NOW(), status = CASE WHEN status = 'draft' THEN 'sent' ELSE status END WHERE id = $1",
      [inv.id]
    );

    res.json({ success: true, message: 'Invoice email sent successfully' });
  } catch (err) {
    logger.error('POST /api/invoices/:id/resend-email error', { err: err.message });
    res.status(500).json({ error: 'Failed to send invoice email' });
  }
});

module.exports = router;
