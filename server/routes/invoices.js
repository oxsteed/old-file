const { randomUUID } = require('crypto');
const express = require('express');
const router = express.Router();
const pool = require('../db');
const { authenticate } = require('../middleware/auth');
const { requireSuperAdmin } = require('../middleware/adminAuth');
const { generalLimiter, strictLimiter } = require('../middleware/rateLimiter');
const logger = require('../utils/logger');
const { logAdminAction } = require('../services/auditService');
const { sendBusinessInvoiceEmail } = require('../utils/businessInvoiceEmail');
const { listUserInvoices, getUserInvoiceById } = require('../services/userInvoicesService');
// P3-9-F03: the super-admin endpoints below used to bypass every guard the
// business-side path enforces (immutability of paid/cancelled invoices,
// legal status transitions, already-paid rejection). They now apply the same
// helpers.
const {
  validateInvoiceUpdate,
  resolvePaymentDelta,
} = require('../utils/businessInvoiceHelpers');
const businessInvoiceCreditController = require('../controllers/businessInvoiceCreditController');
const businessInvoiceStripeConnectController = require('../controllers/businessInvoiceStripeConnectController');
const mobileController = require('../controllers/mobileController');
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
router.get('/:id/card-eligibility', authenticate, generalLimiter, businessInvoiceStripeConnectController.getInvoiceCardEligibility);
router.post(
  '/:id/pay-with-credit',
  strictLimiter,
  authenticate,
  rejectImpersonated,
  businessInvoiceCreditController.payInvoiceWithOxsteedCredit,
);
router.post(
  '/:id/payment-intent',
  strictLimiter,
  authenticate,
  rejectImpersonated,
  (req, res, next) => {
    req.params.invoiceId = req.params.id;
    return mobileController.createInvoicePaymentIntent(req, res, next);
  },
);
router.post(
  '/:id/confirm-payment',
  strictLimiter,
  authenticate,
  rejectImpersonated,
  (req, res, next) => {
    req.params.invoiceId = req.params.id;
    return mobileController.confirmInvoicePayment(req, res, next);
  },
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
    const { rows: [existing] } = await pool.query(
      'SELECT id, status, total, amount_paid, invoice_number FROM business_invoices WHERE id = $1',
      [req.params.id]
    );
    if (!existing) return res.status(404).json({ error: 'Invoice not found' });
    // P3-9-F03: same guards as the business-side payment path. Paid and
    // cancelled invoices are immutable, and an already fully-paid invoice
    // cannot be marked paid again. resolvePaymentDelta runs first so the
    // already-paid case keeps the business-side 409 semantics; the cancelled
    // rejection is stricter than business-side (fail closed: a voided
    // invoice must not be resurrected as paid).
    const paidAmount = resolvePaymentDelta(undefined, existing.total, existing.amount_paid);
    if (paidAmount.error) {
      const code = paidAmount.error.includes('fully paid') ? 409 : 400;
      return res.status(code).json({ error: paidAmount.error });
    }
    const immutabilityError = validateInvoiceUpdate(existing, {});
    if (immutabilityError) return res.status(400).json({ error: immutabilityError });
    const { rows: [inv] } = await pool.query(
      `UPDATE business_invoices
       SET status = 'paid', paid_at = COALESCE(paid_at, NOW()), amount_paid = total
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
        before: { status: existing.status, amount_paid: existing.amount_paid },
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
    // P3-9-F03: same transition guards as the business-side path. Paid and
    // cancelled invoices are immutable; a sent invoice cannot return to
    // draft, and 'paid' must go through the mark-paid endpoint so the
    // payment math (resolvePaymentDelta) is honored.
    const transitionError = validateInvoiceUpdate(before, { status });
    if (transitionError) return res.status(400).json({ error: transitionError });
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

    const isAdmin = ['admin', 'super_admin'].includes(req.user.role);
    const { rows: [full] } = await pool.query(
      `SELECT bi.*,
              u.preferred_language,
              COALESCE(
                NULLIF(TRIM(b.business_name), ''),
                NULLIF(TRIM(CONCAT(u.first_name, ' ', u.last_name)), '')
              ) AS business_name
         FROM business_invoices bi
         LEFT JOIN businesses b ON b.id = bi.business_id
         LEFT JOIN users u ON u.id = bi.user_id
        WHERE bi.id = $1`,
      [inv.source_id]
    );
    if (!full) {
      return res.status(404).json({ error: 'Invoice not found' });
    }
    const isIssuer = String(full.user_id) === String(req.user.id);
    if (!isAdmin && !isIssuer) {
      return res.status(403).json({ error: 'Only the invoice issuer can resend email' });
    }

    if (!full.client_email) {
      return res.status(400).json({ error: 'Invoice has no client email address' });
    }
    if (!full.public_token) {
      return res.status(409).json({ error: 'Invoice is missing a public link token' });
    }

    const emailResult = await sendBusinessInvoiceEmail({
      invoice: full,
      recipientEmail: full.client_email,
      issuerName: full.business_name || 'OxSteed',
      language: full.preferred_language || 'en',
      idempotencyKey: `business-invoice:resend:${full.id}:${randomUUID()}:${full.client_email.toLowerCase()}`,
    });
    if (!emailResult.success) {
      return res.status(502).json({ error: 'Failed to deliver invoice email' });
    }

    await pool.query(
      "UPDATE business_invoices SET sent_at = NOW(), status = CASE WHEN status = 'draft' THEN 'sent' ELSE status END WHERE id = $1",
      [full.id]
    );

    res.json({ success: true, message: 'Invoice email sent successfully' });
  } catch (err) {
    logger.error('POST /api/invoices/:id/resend-email error', { err: err.message });
    res.status(500).json({ error: 'Failed to send invoice email' });
  }
});

module.exports = router;
