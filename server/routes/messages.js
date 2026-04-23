const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { conversationMessageLimiter, userChatLimiter } = require('../middleware/rateLimiter');
const {
  getConversations,
  getGuestInquiries,
  getGuestInquiryById,
  getOrCreateConversation,
  getConversationMeta,
  getMessages,
  searchMessages,
  sendMessage,
  deleteMessage,
  editMessage,
  addReaction,
  removeReaction,
  getMessageReactions,
} = require('../controllers/messageController');

// All routes require authentication
router.use(authenticate);

// GET /api/messages/guest-inquiries — profile visitors without accounts (helper inbox)
router.get('/guest-inquiries', getGuestInquiries);

// GET /api/messages/guest-inquiries/:id — single inquiry (UUID)
router.get('/guest-inquiries/:id', getGuestInquiryById);

// GET /api/messages/conversations - Get all conversations
router.get('/conversations', getConversations);

// POST /api/messages/conversations - Create or get existing conversation
router.post('/conversations', getOrCreateConversation);

// GET /api/messages/conversations/:conversationId/meta - conversation name, job title, business
router.get('/conversations/:conversationId/meta', getConversationMeta);

// GET /api/messages/conversations/:conversationId - Get messages for a conversation
router.get('/conversations/:conversationId', getMessages);

// GET /api/messages/conversations/:conversationId/search - Search messages in conversation
router.get('/conversations/:conversationId/search', searchMessages);

// POST /api/messages/conversations/:conversationId - Send a message
// Apply both user-level (global) and conversation-level rate limits
// User limit prevents chat spam across all conversations
// Conversation limit prevents spam within a single conversation
router.post('/conversations/:conversationId', userChatLimiter, conversationMessageLimiter, sendMessage);

// DELETE /api/messages/conversations/:conversationId/:messageId - Delete a message
router.delete('/conversations/:conversationId/:messageId', deleteMessage);

// PUT /api/messages/conversations/:conversationId/:messageId - Edit a message
router.put('/conversations/:conversationId/:messageId', editMessage);

// GET /api/messages/conversations/:conversationId/:messageId/reactions - Get all reactions for a message
router.get('/conversations/:conversationId/:messageId/reactions', getMessageReactions);

// POST /api/messages/conversations/:conversationId/:messageId/reactions - Add a reaction
router.post('/conversations/:conversationId/:messageId/reactions', addReaction);

// DELETE /api/messages/conversations/:conversationId/:messageId/reactions - Remove a reaction
router.delete('/conversations/:conversationId/:messageId/reactions', removeReaction);

module.exports = router;
