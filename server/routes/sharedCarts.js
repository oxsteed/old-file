const express = require('express');
const router = express.Router();
const { authenticate, optionalAuth } = require('../middleware/auth');
const { generalLimiter } = require('../middleware/rateLimiter');
const sharedCartsController = require('../controllers/sharedCartsController');

router.use(generalLimiter);

// Share a cart (auth required - helper only)
router.post('/', authenticate, sharedCartsController.shareCart);

// List carts shared directly with the logged-in customer
router.get('/my', authenticate, sharedCartsController.listMySharedCarts);

// View shared cart (public - no auth required)
router.get('/:shareToken', optionalAuth, sharedCartsController.viewSharedCart);

// Modify items in shared cart (public if permitted)
router.put('/:shareToken/items/:itemId', optionalAuth, sharedCartsController.modifySharedCart);

// Add item to shared cart (public if permitted)
router.post('/:shareToken/items', optionalAuth, sharedCartsController.addItemToSharedCart);

// Remove item from shared cart (public if permitted)
router.delete('/:shareToken/items/:itemId', optionalAuth, sharedCartsController.removeItemFromSharedCart);

// Approve cart (auth required - customer)
router.post('/:shareToken/approve', authenticate, sharedCartsController.approveCart);

// Get analytics (auth required - cart owner only)
router.get('/:sharedCartId/stats', authenticate, sharedCartsController.getShareAnalytics);

// Revoke share link (auth required - cart owner only)
router.delete('/:sharedCartId', authenticate, sharedCartsController.revokeShare);

module.exports = router;
