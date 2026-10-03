const express = require('express');
const router = express.Router();
const { authLimiter, conversationMessageLimiter } = require('../middleware/rateLimiter');
const { initiateSupportChat, sendSupportMessage, getAdminStatus } = require('../controllers/supportChatController');

/**
 * GET /api/support-chat/admin-status
 * Check if admins are currently online (public endpoint)
 */
router.get('/admin-status', getAdminStatus);

/**
 * POST /api/support-chat/initiate
 * Initiate support chat or escalate to ticket (public endpoint).
 * Uses the stricter auth limiter (30/15min per IP): every initiation can fan
 * out admin emails, so the general 200/15min bucket is too generous here.
 */
router.post('/initiate', authLimiter, initiateSupportChat);

/**
 * POST /api/support-chat/messages
 * Send a message in an active support chat (authenticated users only).
 * Guests use POST /support-chat/initiate to create a support ticket.
 */
router.post('/messages', conversationMessageLimiter, sendSupportMessage);

module.exports = router;
