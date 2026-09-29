const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { generalLimiter } = require('../middleware/rateLimiter');
const shoppingCartsController = require('../controllers/shoppingCartsController');

// All routes require authentication
router.use(authenticate);
router.use(generalLimiter);

// Create cart
router.post('/', shoppingCartsController.createCart);

// Get all carts (with optional template filter)
router.get('/', shoppingCartsController.getCarts);

// Get templates (shortcut - use GET / with templateOnly=true).
// NOTE: static paths must be registered before /:cartId or Express matches
// them as cart IDs and this route is never reached.
router.get('/templates', shoppingCartsController.getCarts);

// Get single cart with items
router.get('/:cartId', shoppingCartsController.getCart);

// Update cart metadata
router.put('/:cartId', shoppingCartsController.updateCart);

// Delete cart
router.delete('/:cartId', shoppingCartsController.deleteCart);

// Add item to cart
router.post('/:cartId/items', shoppingCartsController.addItem);

// Update item in cart
router.put('/:cartId/items/:itemId', shoppingCartsController.updateItem);

// Remove item from cart
router.delete('/:cartId/items/:itemId', shoppingCartsController.removeItem);

// Save cart as template
router.post('/:cartId/save-as-template', shoppingCartsController.saveAsTemplate);

// Create cart from template
router.post('/from-template/:templateId', shoppingCartsController.createFromTemplate);

module.exports = router;
