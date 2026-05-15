/**
 * Business Product Pricing Routes
 * Mounted at /api/businesses in server/index.js — all paths include :businessId.
 */

const express = require('express');
const router  = express.Router({ mergeParams: true });
const { requireAuth } = require('../middleware/auth');
const ctrl = require('../controllers/businessProductPricingController');

// Pricing rules
router.get(   '/:businessId/product-pricing/rules',           requireAuth, ctrl.listPricingRules);
router.get(   '/:businessId/product-pricing/rules/:ruleId',   requireAuth, ctrl.getPricingRule);
router.post(  '/:businessId/product-pricing/rules',           requireAuth, ctrl.createPricingRule);
router.put(   '/:businessId/product-pricing/rules/:ruleId',   requireAuth, ctrl.updatePricingRule);
router.delete('/:businessId/product-pricing/rules/:ruleId',   requireAuth, ctrl.deletePricingRule);

// Price calculation (public — used during checkout / product page)
router.post('/:businessId/product-pricing/calculate', ctrl.calculatePrice);

// Bulk pricing tiers
router.get( '/:businessId/products/:productId/bulk-pricing',  ctrl.getBulkPricingTiers);
router.post('/:businessId/products/:productId/bulk-pricing',  requireAuth, ctrl.setBulkPricingTiers);

module.exports = router;
