const express = require('express');
const router = express.Router();
const pool = require('../db');
const { authenticate } = require('../middleware/auth');
const { requireAdmin } = require('../middleware/adminAuth');
const { generalLimiter } = require('../middleware/rateLimiter');
const logger = require('../utils/logger');
const { tNotif } = require('../utils/i18n');

// Helper: check invoice ownership or admin
async function getInvoiceForUser(invoiceId, userId, role) {
  const isAdmin = ['admin', 'super_admin'].includes(role);
  const { rows } = await pool.query(
    `SELECT bi.*,
            u.preferred_language,
            b.business_name,
            ROUND(bi.total * 100)::bigint AS amount_cents
     FROM business_invoices bi
     LEFT JOIN businesses b ON b.id = bi.business_id
     LEFT JOIN users u ON u.id = bi.user_id
     WHERE bi.id = $1
       AND ($2 OR bi.user_id = $3)`,
    [invoiceId, isAdmin, userId]
  );
  return rows[0] || null;
}

// GET /api/invoices
router.get('/', authenticate, generalLimiter, async (req, res) => {
  try {
    const limit  = Math.min(parseInt(req.query.limit)  || 20, 100);
    const offset = Math.max(parseInt(req.query.offset) || 0, 0);
    const { status } = req.query;

    const params = [req.user.id, limit, offset];
    const statusClause = status ? 'AND bi.status = $4' : '';
    if (status) params.push(status);

    const { rows } = await pool.query(
      `SELECT bi.id, bi.invoice_number, bi.client_name, bi.client_email,
              bi.status,
              bi.issue_date AS issued_at,
              bi.due_date   AS due_at,
              ROUND(bi.total * 100)::bigint AS amount_cents,
              bi.total, bi.amount_paid, bi.sent_at, bi.paid_at, bi.created_at,
              b.business_name
       FROM business_invoices bi
       LEFT JOIN businesses b ON b.id = bi.business_id
       WHERE bi.user_id = $1 ${statusClause}
       ORDER BY bi.created_at DESC
       LIMIT $2 OFFSET $3`,
      params
    );

    res.json({ success: true, invoices: rows, total: rows.length, limit, offset });
  } catch (err) {
    logger.error('GET /api/invoices error', { err: err.message });
    res.status(500).json({ error: 'Failed to fetch invoices' });
  }
});

// GET /api/invoices/:id
router.get('/:id', authenticate, generalLimiter, async (req, res) => {
  try {
    const inv = await getInvoiceForUser(req.params.id, req.user.id, req.user.role);
    if (!inv) return res.status(404).json({ error: 'Invoice not found' });
    res.json({ success: true, invoice: inv });
  } catch (err) {
    logger.error('GET /api/invoices/:id error', { err: err.message });
    res.status(500).json({ error: 'Failed to fetch invoice' });
  }
});

// PATCH /api/invoices/:id/mark-paid  (admin only)
router.patch('/:id/mark-paid', authenticate, requireAdmin, async (req, res) => {
  try {
    const { rows: [inv] } = await pool.query(
      `UPDATE business_invoices
       SET status = 'paid', paid_at = NOW(), amount_paid = total
       WHERE id = $1 RETURNING *`,
      [req.params.id]
    );
    if (!inv) return res.status(404).json({ error: 'Invoice not found' });
    res.json({ success: true, invoice: inv });
  } catch (err) {
    logger.error('PATCH /api/invoices/:id/mark-paid error', { err: err.message });
    res.status(500).json({ error: 'Failed to update invoice' });
  }
});

// PATCH /api/invoices/:id/status  (admin only)
router.patch('/:id/status', authenticate, requireAdmin, async (req, res) => {
  try {
    const { status } = req.body;
    const valid = ['draft', 'sent', 'paid', 'overdue', 'cancelled', 'partial'];
    if (!status || !valid.includes(status)) {
      return res.status(400).json({ error: 'Valid status required', valid });
    }
    const { rows: [inv] } = await pool.query(
      'UPDATE business_invoices SET status = $1 WHERE id = $2 RETURNING *',
      [status, req.params.id]
    );
    if (!inv) return res.status(404).json({ error: 'Invoice not found' });
    res.json({ success: true, invoice: inv });
  } catch (err) {
    logger.error('PATCH /api/invoices/:id/status error', { err: err.message });
    res.status(500).json({ error: 'Failed to update invoice' });
  }
});

// POST /api/invoices/:id/resend-email  (owner or admin)
router.post('/:id/resend-email', authenticate, generalLimiter, async (req, res) => {
  try {
    const inv = await getInvoiceForUser(req.params.id, req.user.id, req.user.role);
    if (!inv) return res.status(404).json({ error: 'Invoice not found' });

    try {
      const notificationService = require('../services/notificationService');
      if (notificationService && notificationService.sendEmail) {
        const localized = tNotif('invoice_resend', inv.preferred_language || 'en');
        const subject = `${localized.title || 'Invoice'} ${inv.invoice_number}`;
        const message = `${localized.body || 'Your invoice'} ${inv.invoice_number}`;
        await notificationService.sendEmail({
          to: inv.client_email,
          subject,
          text: `${message}.`,
        });
      }
    } catch (_) {}

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
