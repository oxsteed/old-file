const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { getConversations, getOrCreateConversation, getMessages, sendMessage } = require('../controllers/messageController');

// All routes require authentication
router.use(authenticate);

// GET /api/messages/conversations - Get all conversations
router.get('/conversations', getConversations);

// POST /api/messages/conversations - Create or get existing conversation
router.post('/conversations', getOrCreateConversation);

// GET /api/messages/conversations/:conversationId - Get messages for a conversation
router.get('/conversations/:conversationId', getMessages);

// POST /api/messages/conversations/:conversationId - Send a message
router.post('/conversations/:conversationId', sendMessage);

module.exports = router;
