// server/routes/businesses.js
const express = require('express');
const router  = express.Router();
const { authenticate } = require('../middleware/auth');
const upload  = require('../middleware/upload');

const {
  listBusinesses, addBusiness, updateBusiness, setPrimary, deleteBusiness,
  uploadBusinessPhotos,
  getBusinessPublicProfile,
  getBusinessAnalytics,
  getBusinessTax, refreshTaxEstimates, markTaxPaid,
  listGoals, createGoal, updateGoal, deleteGoal,
} = require('../controllers/businessController');

const {
  listInvoices, getInvoice, createInvoice,
  updateInvoice, markInvoicePaid, deleteInvoice,
} = require('../controllers/businessInvoiceController');

const {
  listMembers, inviteMember, revokeMember,
  listMyInvitations, acceptInvitation, declineInvitation,
  listManagedBusinesses,
} = require('../controllers/businessMembersController');

const {
  generateToken, listTokens, revokeToken, redeemToken,
} = require('../controllers/vortexController');

// ── Vortex redeem (no business id — must be before /:id routes) ───────────────
router.post('/vortex/redeem',                authenticate, redeemToken);

// ── Member invitations (must come before /:id routes) ─────────────────────────
router.get('/invitations',                   authenticate, listMyInvitations);
router.post('/invitations/:id/accept',       authenticate, acceptInvitation);
router.post('/invitations/:id/decline',      authenticate, declineInvitation);
router.get('/managed',                       authenticate, listManagedBusinesses);

// ── Public profile (no auth) — must be before authenticated /:id routes ───────
router.get('/:id/public',  getBusinessPublicProfile);

// ── Business CRUD ─────────────────────────────────────────────────────────────
router.get('/',            authenticate, listBusinesses);
router.post('/',           authenticate, addBusiness);
router.put('/:id',         authenticate, updateBusiness);
router.put('/:id/primary', authenticate, setPrimary);
router.put('/:id/photos',  authenticate,
  upload.fields([{ name: 'logo', maxCount: 1 }, { name: 'cover', maxCount: 1 }]),
  uploadBusinessPhotos);
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

// ── Business team members ─────────────────────────────────────────────────────
router.get('/:id/members',                      authenticate, listMembers);
router.post('/:id/members',                     authenticate, inviteMember);
router.delete('/:id/members/:memberId',         authenticate, revokeMember);

// ── Vortex tokens (per-business) ─────────────────────────────────────────────
router.get('/:id/vortex-tokens',                authenticate, listTokens);
router.post('/:id/vortex-tokens',               authenticate, generateToken);
router.delete('/:id/vortex-tokens/:tokenId',    authenticate, revokeToken);

module.exports = router;
