/**
 * Messaging System Routes
 * Routes for business messaging channels, messages, and real-time communication
 */

const express = require('express');
const router = express.Router({ mergeParams: true });
const { requireAuth } = require('../middleware/auth');
const messagingController = require('../controllers/messagingController');

// All routes require authentication
router.use(requireAuth);

// ============================================================================
// Channel Management
// ============================================================================

// List all channels for a business
router.get('/businesses/:businessId/messaging/channels', messagingController.listChannels);

// Get a single channel with members
router.get(
  '/businesses/:businessId/messaging/channels/:channelId',
  messagingController.getChannel
);

// Create a new channel
router.post('/businesses/:businessId/messaging/channels', messagingController.createChannel);

// Update channel details
router.put(
  '/businesses/:businessId/messaging/channels/:channelId',
  messagingController.updateChannel
);

// Delete a channel
router.delete(
  '/businesses/:businessId/messaging/channels/:channelId',
  messagingController.deleteChannel
);

// ============================================================================
// Messages
// ============================================================================

// Get messages in a channel (paginated)
router.get(
  '/businesses/:businessId/messaging/channels/:channelId/messages',
  messagingController.getChannelMessages
);

// Send a message to a channel
router.post(
  '/businesses/:businessId/messaging/channels/:channelId/messages',
  messagingController.sendMessage
);

// Edit a message
router.put(
  '/businesses/:businessId/messaging/channels/:channelId/messages/:messageId',
  messagingController.editMessage
);

// Delete a message
router.delete(
  '/businesses/:businessId/messaging/channels/:channelId/messages/:messageId',
  messagingController.deleteMessage
);

// ============================================================================
// Reactions
// ============================================================================

// Add emoji reaction to a message
router.post(
  '/businesses/:businessId/messaging/channels/:channelId/messages/:messageId/react',
  messagingController.addReaction
);

// Remove emoji reaction
router.delete(
  '/businesses/:businessId/messaging/channels/:channelId/messages/:messageId/react/:emoji',
  messagingController.removeReaction
);

// ============================================================================
// Channel Membership
// ============================================================================

// Add members to a channel
router.post(
  '/businesses/:businessId/messaging/channels/:channelId/members',
  messagingController.addChannelMembers
);

// Remove a member from a channel
router.delete(
  '/businesses/:businessId/messaging/channels/:channelId/members/:memberId',
  messagingController.removeChannelMember
);

module.exports = router;
