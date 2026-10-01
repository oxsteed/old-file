const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { requireAdmin, requirePermission } = require('../middleware/adminAuth');
const adminProductsController = require('../controllers/adminProductsController');

// All admin product routes require admin privileges
router.post('/', requireAuth, requireAdmin, requirePermission('manage_operations'), adminProductsController.createProduct);
router.put('/:productId', requireAuth, requireAdmin, requirePermission('manage_operations'), adminProductsController.updateProduct);
router.delete('/:productId', requireAuth, requireAdmin, requirePermission('manage_operations'), adminProductsController.deleteProduct);
router.post('/bulk-create', requireAuth, requireAdmin, requirePermission('manage_operations'), adminProductsController.bulkCreateProducts);
router.get('/stats', requireAuth, requireAdmin, requirePermission('manage_operations'), adminProductsController.getProductStats);

module.exports = router;
