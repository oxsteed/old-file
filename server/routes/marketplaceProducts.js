const express = require('express');
const router = express.Router();
const { authenticate, optionalAuth } = require('../middleware/auth');
const { generalLimiter } = require('../middleware/rateLimiter');
const marketplaceProductsController = require('../controllers/marketplaceProductsController');

// All routes use rate limiter
router.use(generalLimiter);

// Browse products with advanced filtering and sorting
router.get('/browse', optionalAuth, marketplaceProductsController.browseProducts);

// Search products (Amazon-level with ranking, intent detection, entity recognition)
router.get('/search', optionalAuth, marketplaceProductsController.searchProducts);

// Autocomplete suggestions for search bar
router.get('/autocomplete', optionalAuth, marketplaceProductsController.getAutocompleteSuggestions);

// Get trending searches
router.get('/trending', marketplaceProductsController.getTrendingSearches);

// Recommendation endpoints
router.get('/recommendations/personalized', authenticate, marketplaceProductsController.getPersonalizedRecommendations);
router.get('/recommendations/cross-sell', authenticate, marketplaceProductsController.getCrossSellRecommendations);
router.get('/recommendations/explore', authenticate, marketplaceProductsController.getExploreRecommendations);
router.get('/trending/hot', marketplaceProductsController.getTrendingProducts);

// Get product categories
router.get('/categories', marketplaceProductsController.getCategories);

// Get hierarchical product categories (with parent-child relationship)
router.get('/categories/hierarchy', marketplaceProductsController.getHierarchicalCategories);

// Get all available skills with product counts
router.get('/skills/all', marketplaceProductsController.getSkills);

// Get products by skill
router.get('/by-skill/:skillId', optionalAuth, marketplaceProductsController.getBySkill);

// Get recommended products for authenticated helper's skills
router.get('/recommended', authenticate, marketplaceProductsController.getRecommendedProducts);

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
router.post('/sync-homedepot', authenticate, marketplaceProductsController.syncFromHomeDepot);

module.exports = router;
