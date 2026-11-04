const express = require('express');
const router = express.Router();
const consultingActionItemsController = require('../controllers/consultingActionItemsController');
const { authenticate } = require('../middleware/auth');

// The controller permits customers to read their own action items while
// keeping create/update/delete operations admin-only.
router.use(authenticate);

// Get action items for a session
router.get('/sessions/:sessionId/action-items', consultingActionItemsController.getSessionActionItems);

// Weekly self-audit 2026-11-04 item 4: the POST registration that used to
// sit here was unreachable (consultingAllPhases mounts first on the same
// path), so the web client's creates always ran the adminAuth handler in
// consultingAllPhases, never this controller's createActionItem. The
// shadowed registration and its controller function are deleted; GET, PUT,
// DELETE, and PATCH below are not duplicated and stay here.

// Update action item
router.put('/sessions/:sessionId/action-items/:itemId', consultingActionItemsController.updateActionItem);

// Delete action item
router.delete('/sessions/:sessionId/action-items/:itemId', consultingActionItemsController.deleteActionItem);

// Mark action item as complete
router.patch('/sessions/:sessionId/action-items/:itemId/complete', consultingActionItemsController.completeActionItem);

module.exports = router;
