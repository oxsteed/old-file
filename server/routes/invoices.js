const express = require('express');
const router = express.Router();
const invoiceController = require('../controllers/invoiceController');
const { authenticate } = require('../middleware/auth');

// List user's invoices (authenticated)
router.get('/', authenticate, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const offset = parseInt(req.query.offset) || 0;

    const invoices = await invoiceController.listInvoices(
      req.user.id,
      req.user.role,
      limit,
      offset
    );

    res.json({
      invoices,
      total: invoices.length,
      limit,
      offset,
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch invoices' });
  }
});

// Get specific invoice
router.get('/:id', authenticate, async (req, res) => {
  try {
    const invoice = await invoiceController.getInvoice(
      req.params.id,
      req.user.id,
      req.user.role
    );

    if (!invoice) {
      return res.status(404).json({ error: 'Invoice not found' });
    }

    res.json(invoice);
  } catch (err) {
    if (err.message === 'Access denied') {
      return res.status(403).json({ error: 'Access denied' });
    }
    res.status(500).json({ error: 'Failed to fetch invoice' });
  }
});

// Mark invoice as paid (admin only)
router.patch('/:id/mark-paid', authenticate, async (req, res) => {
  try {
    if (!['admin', 'super_admin'].includes(req.user.role)) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const invoice = await invoiceController.markInvoicePaid(
      req.params.id,
      req.user.id,
      req.user.role
    );

    res.json(invoice);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update invoice' });
  }
});

// Update invoice status (admin only)
router.patch('/:id/status', authenticate, async (req, res) => {
  try {
    if (!['admin', 'super_admin'].includes(req.user.role)) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const { status } = req.body;
    if (!status) {
      return res.status(400).json({ error: 'Status required' });
    }

    const invoice = await invoiceController.updateInvoiceStatus(
      req.params.id,
      status,
      req.user.id,
      req.user.role
    );

    res.json(invoice);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update invoice' });
  }
});

// Resend invoice email (authenticated user or admin)
router.post('/:id/resend-email', authenticate, async (req, res) => {
  try {
    // Verify access to invoice
    const invoice = await invoiceController.getInvoice(
      req.params.id,
      req.user.id,
      req.user.role
    );

    if (!invoice) {
      return res.status(404).json({ error: 'Invoice not found' });
    }

    // Send email
    await invoiceController.sendInvoiceEmail(req.params.id);

    res.json({ message: 'Invoice email sent successfully' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to send invoice email' });
  }
});

module.exports = router;
