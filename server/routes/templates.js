// server/routes/templates.js
// Profile Template System routes

const router = require('express').Router();
const { authenticate } = require('../middleware/auth');
const { requireAdmin, requirePermission } = require('../middleware/adminAuth');
const ctrl = require('../controllers/templateController');

// ── Public ─────────────────────────────────────────────────────────────────
// GET /api/templates — list all templates with current pricing
router.get('/', ctrl.listTemplates);

// ── Authenticated user ──────────────────────────────────────────────────────
// GET /api/templates/my-access — which templates the user has access to
router.get('/my-access', authenticate, ctrl.getMyAccess);

// GET /api/templates/active?type=helper|business
router.get('/active', authenticate, ctrl.getActiveTemplate);

// POST /api/templates/activate — set active template
router.post('/activate', authenticate, ctrl.activateTemplate);

// POST /api/templates/purchase/lifetime — record lifetime purchase
router.post('/purchase/lifetime', authenticate, ctrl.purchaseLifetime);

// ── Admin ───────────────────────────────────────────────────────────────────
// GET /api/templates/admin/pricing
router.get('/admin/pricing', authenticate, requireAdmin, requirePermission('manage_settings'), ctrl.adminGetPricing);

// GET /api/templates/admin/stats
router.get('/admin/stats', authenticate, requireAdmin, requirePermission('manage_operations'), ctrl.adminTemplateStats);

// GET /api/templates/admin/grants
// T23-F01: grant management requires manage_settings, like template pricing.
router.get('/admin/grants', authenticate, requireAdmin, requirePermission('manage_settings'), ctrl.adminListGrants);

// PATCH /api/templates/admin/pricing/:slug
router.patch('/admin/pricing/:slug', authenticate, requireAdmin, requirePermission('manage_settings'), ctrl.adminUpdatePricing);

// PUT /api/templates/admin/pricing/bulk
router.put('/admin/pricing/bulk', authenticate, requireAdmin, requirePermission('manage_settings'), ctrl.adminBulkUpdatePricing);

// POST /api/templates/admin/grants — grant access to a user
router.post('/admin/grants', authenticate, requireAdmin, requirePermission('manage_settings'), ctrl.adminGrantAccess);

// DELETE /api/templates/admin/grants/:accessId — revoke access
router.delete('/admin/grants/:accessId', authenticate, requireAdmin, requirePermission('manage_settings'), ctrl.adminRevokeAccess);

module.exports = router;
