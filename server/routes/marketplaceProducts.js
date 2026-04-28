const express = require('express');
const router = express.Router();
const { authenticate, optionalAuth } = require('../middleware/auth');
const { generalLimiter } = require('../middleware/rateLimiter');
const marketplaceProductsController = require('../controllers/marketplaceProductsController');

// All routes use rate limiter
router.use(generalLimiter);

// Browse products by skill
router.get('/browse', optionalAuth, marketplaceProductsController.browseProducts);

// Search products (full-text)
router.get('/search', optionalAuth, marketplaceProductsController.searchProducts);

// Get product categories
router.get('/categories', marketplaceProductsController.getCategories);

// Get products by skill
router.get('/by-skill/:skillId', optionalAuth, marketplaceProductsController.getBySkill);

// Get single product
router.get('/:productId', optionalAuth, marketplaceProductsController.getProduct);

// Sync from Home Depot (admin/scheduler only)
router.post('/sync-homedepot', authenticate, marketplaceProductsController.syncFromHomeDepot);

module.exports = router;
