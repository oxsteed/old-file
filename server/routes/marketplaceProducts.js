const express = require('express');
const router = express.Router();
const { authenticate, optionalAuth, requireRole } = require('../middleware/auth');
const { generalLimiter } = require('../middleware/rateLimiter');
const marketplaceProductsController = require('../controllers/marketplaceProductsController');

// All routes use rate limiter
router.use(generalLimiter);

// Browse products with advanced filtering and sorting
router.get('/browse', optionalAuth, marketplaceProductsController.browseProducts);

// Search products (full-text search on name + description)
router.get('/search', optionalAuth, marketplaceProductsController.searchProducts);

// Get product categories
router.get('/categories', marketplaceProductsController.getCategories);

// Product search suggestions
router.get('/suggestions', optionalAuth, marketplaceProductsController.getSearchSuggestions);

// Get products by skill
router.get('/by-skill/:skillId', optionalAuth, marketplaceProductsController.getBySkill);

// Get recommended products for authenticated helper's skills
router.get('/recommended', authenticate, marketplaceProductsController.getRecommendedProducts);

// Match Learn kit tool names to in-house products (public; Learn is anonymous-friendly)
router.post('/match-tools', marketplaceProductsController.matchTools);

// Get single product with full details
router.get('/:productId', optionalAuth, marketplaceProductsController.getProductDetail);

// Get related products by skill
router.get('/:productId/related', optionalAuth, marketplaceProductsController.getRelatedProducts);

// Get frequently bought together products
router.get('/:productId/frequently-bought', optionalAuth, marketplaceProductsController.getFrequentlyBoughtWith);

// Get product reviews (paginated)
router.get('/:productId/reviews', optionalAuth, marketplaceProductsController.getProductReviews);

// Submit product review (authenticated helpers only)
router.post('/:productId/reviews', authenticate, marketplaceProductsController.submitProductReview);

// Sync from Home Depot (admin/scheduler only)
router.post('/sync-homedepot', authenticate, requireRole('admin', 'super_admin'), marketplaceProductsController.syncFromHomeDepot);

module.exports = router;
