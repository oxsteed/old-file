/**
 * Business Products Routes
 * Mounted at /api/businesses in server/index.js — all paths include :businessId.
 */

const express = require('express');
const router = express.Router({ mergeParams: true });
const { requireAuth } = require('../middleware/auth');
const ctrl = require('../controllers/businessProductsController');

// List / create products
router.get( '/:businessId/products',                          ctrl.listProducts);
router.post('/:businessId/products', requireAuth,             ctrl.createProduct);

// Low-stock alerts (specific path before :productId to avoid shadowing)
router.get( '/:businessId/products/alerts/low-stock', requireAuth, ctrl.getLowStockAlerts);

// Single product
router.get( '/:businessId/products/:productId',               ctrl.getProduct);
router.put( '/:businessId/products/:productId', requireAuth,  ctrl.updateProduct);
router.delete('/:businessId/products/:productId', requireAuth, ctrl.deleteProduct);

// Variants
router.post('/:businessId/products/:productId/variants', requireAuth, ctrl.createVariant);

// Inventory
router.put(
  '/:businessId/products/:productId/variants/:variantId/inventory',
  requireAuth,
  ctrl.updateVariantInventory
);

module.exports = router;
