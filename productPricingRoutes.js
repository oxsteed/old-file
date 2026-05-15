/**
 * Product Pricing Routes
 * Routes for dynamic pricing, promotions, bundles, and pricing rules
 */

const express = require('express');
const router = express.Router({ mergeParams: true });
const { requireAuth } = require('../middleware/auth');
const productPricingController = require('../controllers/productPricingController');

// ============================================================================
// Pricing Rules
// ============================================================================

// List pricing rules (owner only)
router.get(
  '/businesses/:businessId/product-pricing/rules',
  requireAuth,
  productPricingController.listPricingRules
);

// Get a single pricing rule (owner only)
router.get(
  '/businesses/:businessId/product-pricing/rules/:ruleId',
  requireAuth,
  productPricingController.getPricingRule
);

// Create a pricing rule (owner only)
router.post(
  '/businesses/:businessId/product-pricing/rules',
  requireAuth,
  productPricingController.createPricingRule
);

// Update a pricing rule (owner only)
router.put(
  '/businesses/:businessId/product-pricing/rules/:ruleId',
  requireAuth,
  productPricingController.updatePricingRule
);

// Delete a pricing rule (owner only)
router.delete(
  '/businesses/:businessId/product-pricing/rules/:ruleId',
  requireAuth,
  productPricingController.deletePricingRule
);

// ============================================================================
// Price Calculation
// ============================================================================

// Calculate final price with all rules applied (public)
router.post(
  '/businesses/:businessId/product-pricing/calculate',
  productPricingController.calculatePrice
);

// ============================================================================
// Bulk Pricing
// ============================================================================

// Set bulk pricing tiers (owner only)
router.post(
  '/businesses/:businessId/products/:productId/bulk-pricing',
  requireAuth,
  productPricingController.setBulkPricingTiers
);

// Get bulk pricing tiers (public)
router.get(
  '/businesses/:businessId/products/:productId/bulk-pricing',
  productPricingController.getBulkPricingTiers
);

module.exports = router;
