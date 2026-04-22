const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const {
  getConversations,
  getGuestInquiries,
  getGuestInquiryById,
  getOrCreateConversation,
  getConversationMeta,
  getMessages,
  sendMessage,
  deleteMessage,
  editMessage,
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

// POST /api/messages/conversations/:conversationId - Send a message
router.post('/conversations/:conversationId', sendMessage);

// DELETE /api/messages/conversations/:conversationId/:messageId - Delete a message
router.delete('/conversations/:conversationId/:messageId', deleteMessage);

// PUT /api/messages/conversations/:conversationId/:messageId - Edit a message
router.put('/conversations/:conversationId/:messageId', editMessage);

module.exports = router;
