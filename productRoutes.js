/**
 * Product Management Routes
 * Routes for products, inventory, variants, and reviews
 */

const express = require('express');
const router = express.Router({ mergeParams: true });
const { requireAuth } = require('../middleware/auth');
const productController = require('../controllers/productController');

// ============================================================================
// Product Management
// ============================================================================

// List products (public)
router.get('/businesses/:businessId/products', productController.listProducts);

// Get a single product (public)
router.get('/businesses/:businessId/products/:productId', productController.getProduct);

// Create a product (owner only)
router.post(
  '/businesses/:businessId/products',
  requireAuth,
  productController.createProduct
);

// Update a product (owner only)
router.put(
  '/businesses/:businessId/products/:productId',
  requireAuth,
  productController.updateProduct
);

// Delete a product (owner only)
router.delete(
  '/businesses/:businessId/products/:productId',
  requireAuth,
  productController.deleteProduct
);

// ============================================================================
// Product Variants
// ============================================================================

// Create a variant (owner only)
router.post(
  '/businesses/:businessId/products/:productId/variants',
  requireAuth,
  productController.createVariant
);

// Update variant inventory (owner only)
router.put(
  '/businesses/:businessId/products/:productId/variants/:variantId/inventory',
  requireAuth,
  productController.updateVariantInventory
);

// ============================================================================
// Inventory Management
// ============================================================================

// Get low stock alerts (owner only)
router.get(
  '/businesses/:businessId/products/alerts/low-stock',
  requireAuth,
  productController.getLowStockAlerts
);

module.exports = router;
