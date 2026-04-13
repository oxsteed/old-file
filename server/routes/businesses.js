// server/routes/businesses.js
const express = require('express');
const router  = express.Router();
const { authenticate } = require('../middleware/auth');

const {
  listBusinesses, addBusiness, updateBusiness, setPrimary, deleteBusiness,
  getBusinessAnalytics,
  getBusinessTax, refreshTaxEstimates, markTaxPaid,
  listGoals, createGoal, updateGoal, deleteGoal,
} = require('../controllers/businessController');

const {
  listInvoices, getInvoice, createInvoice,
  updateInvoice, markInvoicePaid, deleteInvoice,
} = require('../controllers/businessInvoiceController');

// ── Business CRUD ─────────────────────────────────────────────────────────────
router.get('/',            authenticate, listBusinesses);
router.post('/',           authenticate, addBusiness);
router.put('/:id',         authenticate, updateBusiness);
router.put('/:id/primary', authenticate, setPrimary);
router.delete('/:id',      authenticate, deleteBusiness);

// ── Analytics (P&L, trends, job stats) ───────────────────────────────────────
router.get('/:id/analytics', authenticate, getBusinessAnalytics);

// ── Invoices ──────────────────────────────────────────────────────────────────
router.get('/:id/invoices',                     authenticate, listInvoices);
router.get('/:id/invoices/:invoiceId',           authenticate, getInvoice);
router.post('/:id/invoices',                    authenticate, createInvoice);
router.put('/:id/invoices/:invoiceId',           authenticate, updateInvoice);
router.post('/:id/invoices/:invoiceId/pay',     authenticate, markInvoicePaid);
router.delete('/:id/invoices/:invoiceId',       authenticate, deleteInvoice);

// ── Tax estimates ─────────────────────────────────────────────────────────────
router.get('/:id/tax',                          authenticate, getBusinessTax);
router.post('/:id/tax/refresh',                 authenticate, refreshTaxEstimates);
router.post('/:id/tax/:estimateId/pay',         authenticate, markTaxPaid);

// ── Revenue / growth goals ────────────────────────────────────────────────────
router.get('/:id/goals',                        authenticate, listGoals);
router.post('/:id/goals',                       authenticate, createGoal);
router.put('/:id/goals/:goalId',                authenticate, updateGoal);
router.delete('/:id/goals/:goalId',             authenticate, deleteGoal);

module.exports = router;
