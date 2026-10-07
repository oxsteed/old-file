const express = require('express');
const router = express.Router();
const pool = require('../db');
const { authenticate } = require('../middleware/auth');
const { requireSuperAdmin } = require('../middleware/adminAuth');
const { generalLimiter } = require('../middleware/rateLimiter');
const logger = require('../utils/logger');
const { logAdminAction } = require('../services/auditService');
const { sendBusinessInvoiceEmail } = require('../utils/businessInvoiceEmail');
const { listUserInvoices, getUserInvoiceById } = require('../services/userInvoicesService');
const businessInvoiceCreditController = require('../controllers/businessInvoiceCreditController');
const { rejectImpersonated } = require('../middleware/rejectImpersonated');

// GET /api/invoices?view=issued|received|all
router.get('/', authenticate, generalLimiter, async (req, res) => {
  try {
    const limit  = Math.min(parseInt(req.query.limit, 10)  || 20, 100);
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
    const status = req.query.status ? String(req.query.status) : null;
    const view = String(req.query.view || 'all').toLowerCase();

    const { invoices, total } = await listUserInvoices({
      userId: req.user.id,
      userEmail: req.user.email || '',
      view,
      status,
      limit,
      offset,
    });

    res.json({
      success: true,
      invoices,
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

router.get('/:id/credit-payee-enrollment', authenticate, generalLimiter, businessInvoiceCreditController.getInvoiceCreditPayeeEnrollment);
router.get('/:id/credit-eligibility', authenticate, generalLimiter, businessInvoiceCreditController.getInvoiceCreditEligibility);
router.post(
  '/:id/pay-with-credit',
  authenticate,
  generalLimiter,
  rejectImpersonated,
  businessInvoiceCreditController.payInvoiceWithOxsteedCredit,
);

router.get('/:id', authenticate, generalLimiter, async (req, res) => {
  try {
    const inv = await getUserInvoiceById({
      compositeId: req.params.id,
      userId: req.user.id,
      userEmail: req.user.email,
      role: req.user.role,
    });
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
    if (String(req.params.id).startsWith('tr-')) {
      return res.status(400).json({ error: 'Tool rental invoices use in-app delivery only' });
    }

    const inv = await getUserInvoiceById({
      compositeId: req.params.id,
      userId: req.user.id,
      userEmail: req.user.email,
      role: req.user.role,
    });
    if (!inv || inv.invoice_kind !== 'business') {
      return res.status(404).json({ error: 'Invoice not found' });
    }
    if (inv.perspective === 'received' && !['admin', 'super_admin'].includes(req.user.role)) {
      return res.status(403).json({ error: 'Only the invoice issuer can resend email' });
    }

    const { rows: [full] } = await pool.query(
      `SELECT bi.*, u.preferred_language, b.business_name
         FROM business_invoices bi
         LEFT JOIN businesses b ON b.id = bi.business_id
         LEFT JOIN users u ON u.id = bi.user_id
        WHERE bi.id = $1 AND bi.user_id = $2`,
      [inv.source_id, req.user.id]
    );
    if (!full && !['admin', 'super_admin'].includes(req.user.role)) {
      return res.status(404).json({ error: 'Invoice not found' });
    }
    const record = full || inv;

    if (!record.client_email) {
      return res.status(400).json({ error: 'Invoice has no client email address' });
    }
    if (!record.public_token) {
      return res.status(409).json({ error: 'Invoice is missing a public link token' });
    }

    const emailResult = await sendBusinessInvoiceEmail({
      invoice: record,
      recipientEmail: record.client_email,
      issuerName: record.business_name || 'OxSteed',
      language: record.preferred_language || 'en',
    });
    if (!emailResult.success) {
      return res.status(502).json({ error: 'Failed to deliver invoice email' });
    }

    await pool.query(
      "UPDATE business_invoices SET sent_at = NOW(), status = CASE WHEN status = 'draft' THEN 'sent' ELSE status END WHERE id = $1",
      [record.id || inv.source_id]
    );

    res.json({ success: true, message: 'Invoice email sent successfully' });
  } catch (err) {
    logger.error('POST /api/invoices/:id/resend-email error', { err: err.message });
    res.status(500).json({ error: 'Failed to send invoice email' });
  }
});

module.exports = router;
