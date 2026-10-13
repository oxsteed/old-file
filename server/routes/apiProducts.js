const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const apiProductsController = require('../controllers/apiProductsController');
const { strictLimiter } = require('../middleware/rateLimiter');

// Creator routes
router.post('/', requireAuth, apiProductsController.createApiProduct);
router.get('/creator/all', requireAuth, apiProductsController.getCreatorApiProducts);
router.post('/:productId/publish', requireAuth, apiProductsController.publishApiProduct);

// Public route (no auth needed)
router.get('/:productId', apiProductsController.getApiProduct);

// API keys management
router.post('/:productId/keys/generate', requireAuth, apiProductsController.generateApiKey);
router.get('/:productId/keys', requireAuth, apiProductsController.getApiKeys);
router.post('/:keyId/revoke', requireAuth, apiProductsController.revokeApiKey);

// Usage and analytics
router.get('/:productId/usage', requireAuth, apiProductsController.getApiProductUsage);

// Subscriptions
router.post('/:productId/subscribe', strictLimiter, requireAuth, apiProductsController.subscribeToApiProduct);

module.exports = router;
