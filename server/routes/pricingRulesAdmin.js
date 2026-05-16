/**
 * Pricing rules admin routes — mounted at /api/businesses
 * (paths include :businessId so requireBusinessAccess can resolve it)
 */

const express = require('express');
const router = express.Router({ mergeParams: true });
const { requireAuth } = require('../middleware/auth');
const requireBusinessAccess = require('../middleware/requireBusinessAccess');
const ctrl = require('../controllers/pricingRulesAdminController');

// ── SERVICE RULES ────────────────────────────────────────────
router.post  ('/:businessId/pricing/service/:serviceId/rules',
  requireAuth, requireBusinessAccess({ minRole: 'manager' }), ctrl.createServiceRule);
router.get   ('/:businessId/pricing/service/:serviceId/rules',
  requireAuth, requireBusinessAccess({ minRole: 'any' }),     ctrl.listServiceRules);
router.patch ('/:businessId/pricing/service/:serviceId/rules/:ruleId/toggle',
  requireAuth, requireBusinessAccess({ minRole: 'manager' }), ctrl.toggleServiceRule);
router.delete('/:businessId/pricing/service/:serviceId/rules/:ruleId',
  requireAuth, requireBusinessAccess({ minRole: 'manager' }), ctrl.deleteServiceRule);

// ── PRODUCT RULES ────────────────────────────────────────────
router.post  ('/:businessId/pricing/product/:productId/rules',
  requireAuth, requireBusinessAccess({ minRole: 'manager' }), ctrl.createProductRule);
router.get   ('/:businessId/pricing/product/:productId/rules',
  requireAuth, requireBusinessAccess({ minRole: 'any' }),     ctrl.listProductRules);
router.patch ('/:businessId/pricing/product/:productId/rules/:ruleId/toggle',
  requireAuth, requireBusinessAccess({ minRole: 'manager' }), ctrl.toggleProductRule);
router.delete('/:businessId/pricing/product/:productId/rules/:ruleId',
  requireAuth, requireBusinessAccess({ minRole: 'manager' }), ctrl.deleteProductRule);

// ── PREVIEW ──────────────────────────────────────────────────
router.post  ('/:businessId/pricing/preview',
  requireAuth, requireBusinessAccess({ minRole: 'any' }),     ctrl.previewPrice);

module.exports = router;
