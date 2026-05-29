/**
 * Business Products Routes
 * Mounted at /api/businesses in server/index.js — all paths include :businessId.
 */

const express = require('express');
const router = express.Router({ mergeParams: true });
const { requireAuth } = require('../middleware/auth');
const requireBusinessAccess = require('../middleware/requireBusinessAccess');
const ctrl = require('../controllers/businessProductsController');
const sync = require('../services/businessProductMarketplaceSync');
const { sendError, sendSuccess } = require('../utils/apiError');
const { logBusinessAction } = require('../services/businessAuditLog');

// List / create products
router.get ('/:businessId/products',                          requireAuth, requireBusinessAccess({ minRole: 'any' }),     ctrl.listProducts);
router.post('/:businessId/products',                          requireAuth, requireBusinessAccess({ minRole: 'manager' }), ctrl.createProduct);

// Low-stock alerts (specific path before :productId to avoid shadowing)
router.get ('/:businessId/products/alerts/low-stock',         requireAuth, requireBusinessAccess({ minRole: 'any' }),     ctrl.getLowStockAlerts);

// Single product
router.get ('/:businessId/products/:productId',               requireAuth, requireBusinessAccess({ minRole: 'any' }),     ctrl.getProduct);
router.put ('/:businessId/products/:productId',               requireAuth, requireBusinessAccess({ minRole: 'manager' }), ctrl.updateProduct);
router.delete('/:businessId/products/:productId',             requireAuth, requireBusinessAccess({ minRole: 'manager' }), ctrl.deleteProduct);

// Variants
router.post('/:businessId/products/:productId/variants',      requireAuth, requireBusinessAccess({ minRole: 'manager' }), ctrl.createVariant);

// Inventory
router.put('/:businessId/products/:productId/variants/:variantId/inventory',
  requireAuth, requireBusinessAccess({ minRole: 'manager' }), ctrl.updateVariantInventory);

// ── Phase 3: marketplace publishing ────────────────────────────────────
router.post('/:businessId/products/:productId/publish',
  requireAuth, requireBusinessAccess({ minRole: 'manager' }),
  async (req, res, next) => {
    try {
      const result = await sync.publishBusinessProduct(req.params.productId);
      await logBusinessAction(req, {
        action: 'business.product.published',
        target_type: 'business_product',
        target_id: req.params.productId,
        after_state: { marketplace_product_id: result.marketplaceProductId, created: result.created },
      });
      return sendSuccess(res, result);
    } catch (err) {
      if (/not found/i.test(err.message)) return sendError(res, 404, err.message, 'not_found');
      if (/inactive|deleted/i.test(err.message)) return sendError(res, 409, err.message, 'invalid_state');
      next(err);
    }
  });

router.post('/:businessId/products/:productId/unpublish',
  requireAuth, requireBusinessAccess({ minRole: 'manager' }),
  async (req, res, next) => {
    try {
      await sync.unpublishBusinessProduct(req.params.productId);
      await logBusinessAction(req, {
        action: 'business.product.unpublished',
        target_type: 'business_product',
        target_id: req.params.productId,
      });
      return sendSuccess(res, { ok: true });
    } catch (err) { next(err); }
  });

router.post('/:businessId/products/:productId/sync-stock',
  requireAuth, requireBusinessAccess({ minRole: 'any' }),
  async (req, res, next) => {
    try {
      const stock = await sync.syncStock(req.params.productId);
      return sendSuccess(res, { quantity_available: stock });
    } catch (err) { next(err); }
  });

module.exports = router;
