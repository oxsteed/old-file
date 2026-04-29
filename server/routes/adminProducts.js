const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { requireAdmin } = require('../middleware/adminAuth');
const adminProductsController = require('../controllers/adminProductsController');

// All admin product routes require admin privileges
router.post('/', requireAuth, requireAdmin, adminProductsController.createProduct);
router.put('/:productId', requireAuth, requireAdmin, adminProductsController.updateProduct);
router.delete('/:productId', requireAuth, requireAdmin, adminProductsController.deleteProduct);
router.post('/bulk-create', requireAuth, requireAdmin, adminProductsController.bulkCreateProducts);
router.get('/stats', requireAuth, requireAdmin, adminProductsController.getProductStats);

module.exports = router;
