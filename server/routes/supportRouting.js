const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const supportRoutingController = require('../controllers/supportRoutingController');

// Create new support conversation with auto-routing
router.post('/:businessId/conversations', requireAuth, supportRoutingController.createConversation);

// Get conversation details with messages
router.get('/:businessId/conversations/:ticketId', requireAuth, supportRoutingController.getConversation);

// Send message to conversation
router.post('/:businessId/conversations/:ticketId/message', requireAuth, supportRoutingController.sendMessage);

// Update conversation status
router.put('/:businessId/conversations/:ticketId/status', requireAuth, supportRoutingController.updateStatus);

// Manually assign ticket to agent
router.post('/:businessId/conversations/:ticketId/assign', requireAuth, supportRoutingController.assignToAgent);

// Get WebSocket connection status (for monitoring)
router.get('/:businessId/status', requireAuth, supportRoutingController.getStatus);

module.exports = router;
