const express = require('express');
const router = express.Router();
const consultingActionItemsController = require('../controllers/consultingActionItemsController');
const { authenticate } = require('../middleware/auth');

// The controller permits customers to read their own action items while
// keeping create/update/delete operations admin-only.
router.use(authenticate);

// Get action items for a session
router.get('/sessions/:sessionId/action-items', consultingActionItemsController.getSessionActionItems);

// Create action item
router.post('/sessions/:sessionId/action-items', consultingActionItemsController.createActionItem);

// Update action item
router.put('/sessions/:sessionId/action-items/:itemId', consultingActionItemsController.updateActionItem);

// Delete action item
router.delete('/sessions/:sessionId/action-items/:itemId', consultingActionItemsController.deleteActionItem);

// Mark action item as complete
router.patch('/sessions/:sessionId/action-items/:itemId/complete', consultingActionItemsController.completeActionItem);

module.exports = router;
