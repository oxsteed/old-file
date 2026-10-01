const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { requireAdmin, requirePermission } = require('../middleware/adminAuth');
const discountCodesController = require('../controllers/discountCodesController');

// All routes require admin privileges
router.post('/', requireAuth, requireAdmin, requirePermission('manage_marketing'), discountCodesController.createDiscountCode);
router.get('/', requireAuth, requireAdmin, requirePermission('manage_marketing'), discountCodesController.getDiscountCodes);
router.get('/stats', requireAuth, requireAdmin, requirePermission('manage_marketing'), discountCodesController.getDiscountStats);
router.put('/:codeId', requireAuth, requireAdmin, requirePermission('manage_marketing'), discountCodesController.updateDiscountCode);
router.get('/:codeId/usage', requireAuth, requireAdmin, requirePermission('manage_marketing'), discountCodesController.getDiscountCodeUsage);

module.exports = router;
