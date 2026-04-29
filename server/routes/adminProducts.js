const express = require('express');
const router = express.Router();
const { requireAuth, requireAdmin } = require('../middleware/auth');
const adminProductsController = require('../controllers/adminProductsController');

// All admin product routes require admin privileges
router.post('/', requireAuth, requireAdmin, adminProductsController.createProduct);
router.put('/:productId', requireAuth, requireAdmin, adminProductsController.updateProduct);
router.delete('/:productId', requireAuth, requireAdmin, adminProductsController.deleteProduct);
router.post('/bulk-create', requireAuth, requireAdmin, adminProductsController.bulkCreateProducts);
router.get('/stats', requireAuth, requireAdmin, adminProductsController.getProductStats);

module.exports = router;
