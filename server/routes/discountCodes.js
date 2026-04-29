const express = require('express');
const router = express.Router();
const { requireAuth, requireAdmin } = require('../middleware/auth');
const discountCodesController = require('../controllers/discountCodesController');

// All routes require admin privileges
router.post('/', requireAuth, requireAdmin, discountCodesController.createDiscountCode);
router.get('/', requireAuth, requireAdmin, discountCodesController.getDiscountCodes);
router.get('/stats', requireAuth, requireAdmin, discountCodesController.getDiscountStats);
router.put('/:codeId', requireAuth, requireAdmin, discountCodesController.updateDiscountCode);
router.get('/:codeId/usage', requireAuth, requireAdmin, discountCodesController.getDiscountCodeUsage);

module.exports = router;
