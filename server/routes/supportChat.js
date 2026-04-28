const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { initiateSupportChat, sendSupportMessage, getAdminStatus } = require('../controllers/supportChatController');

/**
 * GET /api/support-chat/admin-status
 * Check if admins are currently online (public endpoint)
 */
router.get('/admin-status', getAdminStatus);

/**
 * POST /api/support-chat/initiate
 * Initiate support chat or escalate to ticket (public endpoint)
 */
router.post('/initiate', initiateSupportChat);

/**
 * POST /api/support-chat/messages
 * Send a message in an active support chat (authenticated or as guest)
 */
router.post('/messages', sendSupportMessage);

module.exports = router;
