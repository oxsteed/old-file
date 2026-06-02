/**
 * Business Product Pricing Routes
 * Mounted at /api/businesses in server/index.js — all paths include :businessId.
 */

const express = require('express');
const router  = express.Router({ mergeParams: true });
const { requireAuth } = require('../middleware/auth');
const requireBusinessAccess = require('../middleware/requireBusinessAccess');
const ctrl = require('../controllers/businessProductPricingController');

// Pricing rules
router.get(   '/:businessId/product-pricing/rules',           requireAuth, requireBusinessAccess({ minRole: 'any' }),     ctrl.listPricingRules);
router.get(   '/:businessId/product-pricing/rules/:ruleId',   requireAuth, requireBusinessAccess({ minRole: 'any' }),     ctrl.getPricingRule);
router.post(  '/:businessId/product-pricing/rules',           requireAuth, requireBusinessAccess({ minRole: 'manager' }), ctrl.createPricingRule);
router.put(   '/:businessId/product-pricing/rules/:ruleId',   requireAuth, requireBusinessAccess({ minRole: 'manager' }), ctrl.updatePricingRule);
router.delete('/:businessId/product-pricing/rules/:ruleId',   requireAuth, requireBusinessAccess({ minRole: 'manager' }), ctrl.deletePricingRule);

// Price calculation (public — used during checkout / product page)
router.post('/:businessId/product-pricing/calculate', ctrl.calculatePrice);

// Bulk pricing tiers
router.get( '/:businessId/products/:productId/bulk-pricing',  ctrl.getBulkPricingTiers);
router.post('/:businessId/products/:productId/bulk-pricing',  requireAuth, requireBusinessAccess({ minRole: 'manager' }), ctrl.setBulkPricingTiers);

module.exports = router;
